// src/services/persistenceService.js
//
// Serviço de persistência desacoplado para auditoria de trades.
//
// DESIGN:
//   - Conexão lazy (Pool criado na primeira query, nunca no import)
//   - safeQuery: NUNCA lança exceção — falhas são logadas e ignoradas
//   - A execução de trades NUNCA é bloqueada por falha de persistência
//   - Banco é usado somente como histórico/auditoria — zero lógica de trading aqui
//
// CONFIGURAÇÃO:
//   SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
//   O arquivo deve conter apenas a connection string PostgreSQL (chmod 600, fora do repo)
//   Formato: postgresql://user:password@host:port/database
//
// SE SUPABASE_DB_URL_PATH NÃO ESTIVER DEFINIDO:
//   Persistência é silenciosamente desabilitada. O bot opera normalmente.
//
// SCHEMA — trades (fonte da verdade):
// ─────────────────────────────────────────────────────────────────────────────
//   create table trades (
//     id            uuid primary key default gen_random_uuid(),
//     bot_trade_ref text unique,
//     symbol        text not null,
//     side          text not null check (side in ('LONG','SHORT')),
//     status        text not null check (status in ('OPEN','CLOSED','CANCELLED')),
//     mode          text not null check (mode in ('paper','live')),
//     source        text not null check (source in ('auto','telegram','dashboard','system')),
//     venue         text not null,
//     strategy_name text,
//     entry_price   numeric,
//     exit_price    numeric,
//     size          numeric,
//     leverage      numeric,
//     realized_pnl  numeric,
//     opened_at     timestamp not null default now(),
//     closed_at     timestamp,
//     created_at    timestamp not null default now()
//   );
//   -- migração: ALTER TABLE trades ADD COLUMN bot_trade_ref text unique;
// ─────────────────────────────────────────────────────────────────────────────
//
// SCHEMA — trade_events (trilha leve de auditoria):
// ─────────────────────────────────────────────────────────────────────────────
//   create table trade_events (
//     id            uuid primary key default gen_random_uuid(),
//     event_type    text not null,
//     bot_trade_ref text,              -- nullable: desconhecido em closes pós-restart
//     payload       jsonb,             -- contexto mínimo sanitizado; null quando vazio
//     occurred_at   timestamp not null default now()
//   );
//
//   event_type válidos (sem CHECK constraint — extensível):
//     TRADE_OPEN_REQUESTED | TRADE_OPEN_PERSISTED
//     TRADE_CLOSE_REQUESTED | TRADE_CLOSE_PERSISTED
//     TRADE_PERSIST_FAILED
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync } from 'fs';
import { randomUUID }   from 'crypto';
import pkg from 'pg';
import logger from '../utils/logger.js';
import state from '../core/state.js';

const { Pool } = pkg;

// ── Normalização de source ────────────────────────────────────────────────────
//
// O schema aceita apenas ('auto','telegram','dashboard','system').
// 'manual' (usado internamente no openManualTrade) é mapeado para 'dashboard'.
// Qualquer outro valor desconhecido cai em 'auto' como fallback seguro.
const _SOURCE_VALID = new Set(['auto', 'telegram', 'dashboard', 'system']);
const _SOURCE_MAP   = { manual: 'dashboard' };

function _normalizeSource(source) {
  if (_SOURCE_VALID.has(source)) return source;
  return _SOURCE_MAP[source] ?? 'auto';
}

// ── Mapa em memória: `${venue}:${symbol}` → UUID do registro aberto no banco ──
//
// Chave composta venue+symbol evita colisão quando o mesmo símbolo está aberto
// em venues diferentes simultaneamente (ex: SOL em drift e SOL em valiant).
// Perdido em restart do processo — recordTradeClosed() possui fallback por symbol+venue.
const _openTradeIds = new Map();

// ── Mapa em memória: `${venue}:${symbol}` → bot_trade_ref (UUID gerado no caller) ──
//
// Preenchido em recordTradeOpened(). Injetado em cada entrada de state.positions
// via listener 'positions:update' em init(), tornando-o disponível nos snapshots
// de posição capturados antes do close — independente de restart.
const _botTradeRefs = new Map();

let _pool = null;

// ── Pool lazy ─────────────────────────────────────────────────────────────────
//
// Criado na primeira query. Retorna null se SUPABASE_DB_URL_PATH não estiver
// definido ou se o arquivo não puder ser lido — persistência degradada silenciosamente.
function _getPool() {
  if (_pool) return _pool;

  const pathVar  = 'SUPABASE_DB_URL_PATH';
  const filePath = process.env[pathVar]?.trim();

  if (!filePath) return null;

  let connectionString;
  try {
    connectionString = readFileSync(filePath, 'utf-8').trim();
  } catch (err) {
    logger.error(`[PERSIST] Não foi possível ler ${pathVar} em "${filePath}": ${err.message}`);
    return null;
  }

  if (!connectionString) {
    logger.error(`[PERSIST] Arquivo ${pathVar} está vazio: "${filePath}"`);
    return null;
  }

  _pool = new Pool({
    connectionString,
    ssl:                     { rejectUnauthorized: false },
    max:                     3,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 5_000,
  });

  _pool.on('error', (err) => {
    logger.warn(`[PERSIST] Pool error (não fatal): ${err.message}`);
  });

  logger.info(`[PERSIST] Pool PostgreSQL criado`);
  return _pool;
}

// ── safeQuery ─────────────────────────────────────────────────────────────────
//
// Executa qualquer query sem nunca lançar exceção.
// Retorna o resultado pg ou null em caso de falha/indisponibilidade.
async function safeQuery(sql, params) {
  const pool = _getPool();
  if (!pool) return null;

  try {
    return await pool.query(sql, params);
  } catch (err) {
    logger.warn(`[PERSIST] Query falhou (não fatal): ${err.message}`);
    return null;
  }
}

// ── Trade Events (trilha de auditoria leve) ───────────────────────────────────
//
// Grava um evento pontual na tabela trade_events.
// Nunca lança exceção — safeQuery absorve qualquer falha silenciosamente.
//
// Colunas usadas no INSERT:
//   event_type    text not null
//   bot_trade_ref text (nullable — desconhecido em REQUESTED antes do INSERT)
//   payload       jsonb (contexto mínimo sanitizado: symbol, venue, mode, error)
//
// Se a tabela não tiver a coluna `payload`, remova-a do INSERT abaixo.
// Se `event_type` tiver CHECK constraint, certifique-se que os 5 valores
// abaixo estão na lista permitida.
//
// event_type válidos:
//   TRADE_OPEN_REQUESTED | TRADE_OPEN_PERSISTED
//   TRADE_CLOSE_REQUESTED | TRADE_CLOSE_PERSISTED
//   TRADE_PERSIST_FAILED
async function _recordEvent(eventType, context = {}) {
  const {
    bot_trade_ref = null,
    symbol        = null,
    venue         = null,
    mode          = null,
    error         = null,
  } = context;

  const payload = {};
  if (symbol !== null) payload.symbol = symbol;
  if (venue  !== null) payload.venue  = venue;
  if (mode   !== null) payload.mode   = mode;
  // Erro truncado a 500 chars — evita stack traces e dados acidentais
  if (error  !== null) payload.error  = String(error).slice(0, 500);

  // Passa null quando não há contexto útil — evita gravar '{}' desnecessariamente.
  // $3::jsonb: cast explícito evita ambiguidade de coerção text→jsonb no driver pg.
  const payloadJson = Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;

  await safeQuery(
    `INSERT INTO trade_events (event_type, bot_trade_ref, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [eventType, bot_trade_ref, payloadJson]
  );
}

// ── _insertOrder ──────────────────────────────────────────────────────────────
//
// Insere uma linha na tabela `orders` com os dados reais de execução retornados
// pelo adapter (fill price real, exchange order ID).
// Nunca lança exceção — safeQuery absorve qualquer falha silenciosamente.
// Se a tabela não existir, o INSERT falha silenciosamente sem impacto no runtime.
//
// Campos:
//   bot_trade_ref  text   — mesmo ref do trade pai na tabela trades
//   order_id       text   — ID da ordem na exchange (signatures.marketOrder)
//   venue          text
//   symbol         text
//   side           text   — 'LONG' | 'SHORT'
//   size           numeric — collateralUSD (USD, consistente com trades.size)
//   price          numeric — fill price real (result.entry) ou entry_price solicitado
//   status         text   — 'FILLED' (default)
async function _insertOrder({ bot_trade_ref, order_id, venue, symbol, side, size, price, status = 'FILLED' }) {
  await safeQuery(
    `INSERT INTO orders (bot_trade_ref, order_id, venue, symbol, side, size, price, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [bot_trade_ref, order_id ?? null, venue, symbol, side, size ?? null, price ?? null, status]
  );
}

// ── _insertBalanceSnapshot ────────────────────────────────────────────────────
//
// Insere um snapshot de saldo no momento da abertura do trade.
// equity e available_balance = freeCollateral pré-trade (walletBalance no caller).
//   Nota: em live Drift, totalEquity > freeCollateral quando há PnL não realizado.
//   Aqui usamos freeCollateral — é o número que o risk manager usou para sizing.
//   Em Valiant, pode incluir spot USDC (equityOverride combinado).
// used_balance = collateralUSD alocado neste trade específico.
// Nunca lança exceção — safeQuery absorve qualquer falha silenciosamente.
async function _insertBalanceSnapshot({ bot_trade_ref, mode, venue, equity, available_balance, used_balance }) {
  await safeQuery(
    `INSERT INTO balance_snapshots (bot_trade_ref, mode, venue, equity, available_balance, used_balance)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [bot_trade_ref, mode ?? null, venue, equity ?? null, available_balance ?? null, used_balance ?? null]
  );
}

// ── _insertSignalDecision ─────────────────────────────────────────────────────
//
// Persiste a decisão de execução associada a uma abertura de trade.
// Chamado apenas dentro do caminho de sucesso de recordTradeOpened (id != null),
// portanto decision é sempre 'APPROVED' nesta v1.
// Rejeições (bot_paused, risk_manager, insufficient_balance) não têm bot_trade_ref
// disponível e são tratadas em index.js antes de executeSignal — fora do escopo desta v1.
// Nunca lança exceção — safeQuery absorve qualquer falha silenciosamente.
async function _insertSignalDecision({ bot_trade_ref, symbol, side, decision, reason, source }) {
  await safeQuery(
    `INSERT INTO signal_decisions (bot_trade_ref, symbol, side, decision, reason, source)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [bot_trade_ref, symbol, side, decision, reason ?? null, source ?? null]
  );
}

// ── PersistenceService ────────────────────────────────────────────────────────

export const persistenceService = {

  /**
   * Inicializa o serviço — valida config e testa conectividade.
   * Chamado no boot (main()). Nunca lança exceção.
   * Se banco indisponível: loga aviso e continua com persistência degradada.
   */
  async init() {
    const pathVar = 'SUPABASE_DB_URL_PATH';

    if (!process.env[pathVar]?.trim()) {
      logger.info(`[PERSIST] ${pathVar} não definido — persistência desabilitada`);
    } else {
      // Teste de conectividade — _getPool() já valida arquivo e cria o pool
      const result = await safeQuery('SELECT 1 AS ok', []);
      if (result) {
        logger.info(`[PERSIST] ✓ Conectado ao banco (Supabase PostgreSQL)`);
      } else {
        logger.warn(`[PERSIST] Banco indisponível no startup — persistência degradada (bot opera normalmente)`);
      }
    }

    // ── Injeta bot_trade_ref nas posições a cada atualização do poller ──────────
    //
    // O poller substitui state.positions inteiramente a cada ciclo. Este listener
    // re-anexa os refs conhecidos às posições presentes no array, mantendo-os
    // disponíveis para captura nos snapshots de posição antes de qualquer close.
    // Opera mesmo quando persistência está desabilitada (refs são apenas strings).
    state.on('positions:update', (positions) => {
      for (const pos of positions) {
        const key = `${pos.venue}:${pos.asset}`;
        const ref = _botTradeRefs.get(key);
        if (ref != null) pos.bot_trade_ref = ref;
      }
    });
  },

  /**
   * Registra a abertura de um trade na tabela `trades` (status=OPEN).
   *
   * Armazena o UUID retornado em _openTradeIds e o bot_trade_ref em _botTradeRefs
   * para uso no fechamento. Nunca lança exceção.
   *
   * @param {object}      data
   * @param {string}      data.symbol         - e.g. 'SOL', 'BTC'
   * @param {string}      data.side           - 'LONG' | 'SHORT'
   * @param {string}      data.mode           - 'paper' | 'live'
   * @param {string}      data.source         - 'auto' | 'telegram' | 'dashboard' | 'system' | 'manual'
   * @param {string}      data.venue
   * @param {number}      data.entry_price
   * @param {number}      data.size           - notional position size in USD
   * @param {number}      data.leverage
   * @param {string}      [data.bot_trade_ref] - deterministic UUID gerado pelo caller (crypto.randomUUID())
   *
   * @returns {Promise<string|null>} UUID do registro inserido, ou null se falhou
   */
  async recordTradeOpened(data, execResult = null) {
    const {
      symbol, side, mode, source, venue,
      entry_price, size, leverage,
      bot_trade_ref,
      pre_trade_equity,
    } = data;

    const mapKey = `${venue}:${symbol.toUpperCase()}`;
    const ref    = bot_trade_ref ?? randomUUID();

    // Registra o ref imediatamente — disponível para o listener positions:update
    // mesmo que o INSERT falhe (ex: banco indisponível).
    _botTradeRefs.set(mapKey, ref);

    await _recordEvent('TRADE_OPEN_REQUESTED', { bot_trade_ref: ref, symbol, venue, mode });

    const result = await safeQuery(
      `INSERT INTO trades (
         bot_trade_ref, symbol, side, status, mode, source, venue,
         entry_price, size, leverage
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        ref,
        symbol,
        side,
        'OPEN',
        mode,
        _normalizeSource(source),
        venue,
        entry_price ?? null,
        size        ?? null,
        leverage    ?? null,
      ]
    );

    const id = result?.rows?.[0]?.id ?? null;

    if (id != null) {
      _openTradeIds.set(mapKey, id);
      logger.info(`[PERSIST] Trade aberto registrado — id=${id} ref=${ref} venue=${venue} symbol=${symbol} side=${side}`);
      await _recordEvent('TRADE_OPEN_PERSISTED', { bot_trade_ref: ref, symbol, venue, mode });

      // ── Persiste ordem de execução (best-effort) ──────────────────────────
      // Chamado apenas quando o trade foi persistido com sucesso E execResult
      // foi passado pelo caller. Falha silenciosa via safeQuery.
      // size em USD (collateralUSD) — consistente com trades.size.
      if (execResult != null) {
        const orderPrice = execResult.entry          ?? entry_price  ?? null;
        const orderSize  = execResult.collateralUSD  ?? size         ?? null;
        const orderId    = execResult.signatures?.marketOrder        ?? null;
        await _insertOrder({
          bot_trade_ref: ref,
          order_id:      orderId,
          venue,
          symbol,
          side,
          size:          orderSize,
          price:         orderPrice,
        });
        logger.info(`[PERSIST] Order registrada — ref=${ref} order_id=${orderId} price=${orderPrice} size=${orderSize}`);

        // ── Balance snapshot ──────────────────────────────────────────────
        // pre_trade_equity = freeCollateral pré-trade (walletBalance no caller).
        // Só registrado quando disponível — callers legados sem esse campo
        // continuam funcionando normalmente (pre_trade_equity === undefined → null).
        if (pre_trade_equity != null) {
          await _insertBalanceSnapshot({
            bot_trade_ref:     ref,
            mode,
            venue,
            equity:            pre_trade_equity,
            available_balance: pre_trade_equity,
            used_balance:      execResult.collateralUSD ?? null,
          });
          logger.info(`[PERSIST] Balance snapshot registrado — ref=${ref} equity=${pre_trade_equity} used=${execResult.collateralUSD ?? null}`);
        }
        // ─────────────────────────────────────────────────────────────────
      }

      // ── Signal decision (APPROVED-only v1) ───────────────────────────────
      // Chamado incondicionalmente dentro do bloco if (id != null) — a decisão
      // é sempre APPROVED aqui, pois recordTradeOpened só é chamado após execução
      // bem-sucedida. Rejeições não chegam a este ponto.
      await _insertSignalDecision({
        bot_trade_ref: ref,
        symbol,
        side,
        decision:      'APPROVED',
        reason:        'trade_executed',
        source,
      });
      // ─────────────────────────────────────────────────────────────────────
    } else {
      await _recordEvent('TRADE_PERSIST_FAILED', { bot_trade_ref: ref, symbol, venue, mode, error: 'INSERT trades retornou null id' });
    }

    return id;
  },

  /**
   * Registra o fechamento de um trade (status=CLOSED, UPDATE na tabela `trades`).
   *
   * exit_price e realized_pnl são lidos de state.positions no momento do
   * fechamento (markPrice e pnlUSD do último poll — máximo 30s de defasagem,
   * aceitável para auditoria).
   *
   * Estratégia de lookup — em ordem de prioridade:
   *   1. botTradeRef passado pelo caller (gerado no open, sobrevive a restart via state.positions)
   *   2. UUID em _openTradeIds[`${venue}:${symbol}`] (mesmo processo, sem restart)
   *   3. Heurística SQL: trade mais recente com symbol+venue sem closed_at (fallback de restart)
   *
   * Nunca lança exceção.
   *
   * @param {string}      symbol        - e.g. 'SOL', 'BTC'
   * @param {string}      venue         - e.g. 'drift', 'valiant', 'paper'
   * @param {string|null} [botTradeRef] - UUID gerado no open; lido de pos.bot_trade_ref pelo caller
   */
  async recordTradeClosed(symbol, venue, botTradeRef = null) {
    const symbolUpper = symbol?.toUpperCase();
    if (!symbolUpper || !venue) return;

    const mapKey  = `${venue}:${symbolUpper}`;
    const tradeId = _openTradeIds.get(mapKey) ?? null;

    // Snapshot da posição antes de ser removida do state pelo poller.
    // Filtra por venue para precisão em cenário multi-venue.
    // Nota: state.positions usa p.asset internamente — mapeia para o symbol.
    const pos          = state.positions.find(p => p.asset === symbolUpper && p.venue === venue);
    const exit_price   = pos?.markPrice ?? null;
    const realized_pnl = pos?.pnlUSD   ?? null;

    await _recordEvent('TRADE_CLOSE_REQUESTED', { bot_trade_ref: botTradeRef, symbol: symbolUpper, venue });

    let result;

    if (botTradeRef != null) {
      // Prioridade 1: fechar pelo ref determinístico — independente de Map em memória.
      // Sobrevive a restarts porque PositionManager injeta o ref do disco (PositionStore)
      // nos objetos de posição antes do close, via _onPositionsUpdate.
      logger.info(`[PERSIST] closing trade by bot_trade_ref — ref=${botTradeRef} venue=${venue} symbol=${symbolUpper}`);
      result = await safeQuery(
        `UPDATE trades
         SET status = 'CLOSED', exit_price = $2, realized_pnl = $3, closed_at = NOW()
         WHERE bot_trade_ref = $1 AND closed_at IS NULL`,
        [botTradeRef, exit_price, realized_pnl]
      );
    } else if (tradeId != null) {
      // Prioridade 2: fechar pelo UUID do banco — mesmo processo, sem restart.
      logger.info(`[PERSIST] closing trade by db id — id=${tradeId} venue=${venue} symbol=${symbolUpper}`);
      result = await safeQuery(
        `UPDATE trades
         SET status = 'CLOSED', exit_price = $1, realized_pnl = $2, closed_at = NOW()
         WHERE id = $3 AND closed_at IS NULL`,
        [exit_price, realized_pnl, tradeId]
      );
    } else {
      // Prioridade 3: bot reiniciou e bot_trade_ref não está disponível em state.positions.
      // Atualiza o trade aberto mais recente para esse symbol+venue.
      logger.warn(`[PERSIST] ref/id em memória não encontrado para ${venue}:${symbolUpper} — fallback por symbol+venue`);
      result = await safeQuery(
        `UPDATE trades
         SET status = 'CLOSED', exit_price = $1, realized_pnl = $2, closed_at = NOW()
         WHERE id = (
           SELECT id FROM trades
           WHERE symbol = $3 AND venue = $4 AND closed_at IS NULL
           ORDER BY opened_at DESC
           LIMIT 1
         )`,
        [exit_price, realized_pnl, symbolUpper, venue]
      );
    }

    const rowsAffected = result?.rowCount ?? 0;
    if (rowsAffected > 0) {
      _openTradeIds.delete(mapKey);
      _botTradeRefs.delete(mapKey);
      logger.info(`[PERSIST] Trade fechado registrado — venue=${venue} symbol=${symbolUpper} ref=${botTradeRef ?? tradeId ?? 'fallback'} rows=${rowsAffected}`);
      await _recordEvent('TRADE_CLOSE_PERSISTED', { bot_trade_ref: botTradeRef, symbol: symbolUpper, venue });
    } else {
      logger.warn(`[PERSIST] Trade close update afetou 0 rows — venue=${venue} symbol=${symbolUpper} ref=${botTradeRef ?? tradeId ?? 'fallback'}`);
      await _recordEvent('TRADE_PERSIST_FAILED', { bot_trade_ref: botTradeRef, symbol: symbolUpper, venue, error: 'UPDATE trades afetou 0 rows' });
    }
  },
};

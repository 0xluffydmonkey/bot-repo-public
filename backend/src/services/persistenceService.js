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
    close_source  = null,
    open_source   = null,
  } = context;

  const payload = {};
  if (symbol       !== null) payload.symbol       = symbol;
  if (venue        !== null) payload.venue        = venue;
  if (mode         !== null) payload.mode         = mode;
  if (close_source !== null) payload.close_source = close_source;
  if (open_source  !== null) payload.open_source  = open_source;
  // Erro truncado a 500 chars — evita stack traces e dados acidentais
  if (error        !== null) payload.error        = String(error).slice(0, 500);

  // Passa null quando não há contexto útil — evita gravar '{}' desnecessariamente.
  // $3::jsonb: cast explícito evita ambiguidade de coerção text→jsonb no driver pg.
  const payloadJson = Object.keys(payload).length > 0 ? JSON.stringify(payload) : null;

  // Tenta INSERT com coluna payload (schema v2).
  // Fallback sem payload caso a coluna não exista na tabela — evita perda silenciosa
  // de eventos quando a tabela foi criada antes da coluna payload ser adicionada.
  const evtRes = await safeQuery(
    `INSERT INTO trade_events (event_type, bot_trade_ref, payload)
     VALUES ($1, $2, $3::jsonb)`,
    [eventType, bot_trade_ref, payloadJson]
  );
  if (!evtRes) {
    await safeQuery(
      `INSERT INTO trade_events (event_type, bot_trade_ref)
       VALUES ($1, $2)`,
      [eventType, bot_trade_ref]
    );
  }
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
async function _insertOrder({ bot_trade_ref, order_id, trade_id, venue, symbol, side, size, price, status = 'FILLED' }) {
  // Tenta INSERT com coluna trade_id (requer: ALTER TABLE orders ADD COLUMN IF NOT EXISTS trade_id uuid).
  // Fallback sem trade_id se a coluna ainda não existir — garante que a ordem seja sempre gravada.
  const ordRes = await safeQuery(
    `INSERT INTO orders (bot_trade_ref, order_id, trade_id, venue, symbol, side, size, price, status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [bot_trade_ref, order_id ?? null, trade_id ?? null, venue, symbol, side, size ?? null, price ?? null, status]
  );
  if (!ordRes) {
    await safeQuery(
      `INSERT INTO orders (bot_trade_ref, order_id, venue, symbol, side, size, price, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [bot_trade_ref, order_id ?? null, venue, symbol, side, size ?? null, price ?? null, status]
    );
  }
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

// ── Helpers de filtro por mode (reutilizável em todos os endpoints de metrics) ─
//
// _resolveMode: valida e normaliza o valor recebido do query param.
//   - 'paper' e 'all' são aceitos explicitamente.
//   - qualquer outro valor (incluindo ausente/undefined/inválido) → 'live'.
//
// _modeFilter: retorna o fragmento SQL e os params correspondentes.
//   - 'all'         → sem filtro de mode  (modeFilter = '', params = [])
//   - 'live'/'paper'→ AND mode = $1       (params = [mode])
//
// Uso em queries:
//   const { modeFilter, params } = _modeFilter(_resolveMode(rawMode));
//   safeQuery(`SELECT ... FROM trades WHERE TRUE ${modeFilter}`, params)
//
// Nota: $1 em subqueries e na query principal referencia o mesmo array de
// params — comportamento correto no driver pg com positional placeholders.

function _resolveMode(raw) {
  if (raw === 'paper' || raw === 'all') return raw;
  return 'live';
}

function _modeFilter(mode) {
  if (mode === 'all') return { modeFilter: '', params: [] };
  return { modeFilter: 'AND mode = $1', params: [mode] };
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
          trade_id:      id,       // UUID do registro em trades — disponível após RETURNING id
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
  async recordTradeClosed(symbol, venue, botTradeRef = null, closeSource = null) {
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

    await _recordEvent('TRADE_CLOSE_REQUESTED', { bot_trade_ref: botTradeRef, symbol: symbolUpper, venue, close_source: closeSource });

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
      // Prioridade 3 (ÚLTIMO RECURSO): bot_trade_ref e db id ausentes — ocorre após restart
      // quando o tracking em disco não tinha bot_trade_ref (tracking pré-feature ou corrompido).
      // ⚠️ FALLBACK: atualiza o trade OPEN mais recente para symbol+venue. Impreciso se houver
      // múltiplos trades OPEN para o mesmo symbol+venue (não deve ocorrer normalmente).
      logger.warn(`[PERSIST] ⚠️ FALLBACK por symbol+venue — bot_trade_ref e id ausentes para ${venue}:${symbolUpper}. Verifique tracking em disco.`);
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
      const closeMethod = botTradeRef != null ? `bot_trade_ref=${botTradeRef}` : tradeId != null ? `db_id=${tradeId}` : 'fallback(symbol+venue)';
      logger.info(`[PERSIST] Trade fechado registrado — venue=${venue} symbol=${symbolUpper} método=${closeMethod} close_source=${closeSource ?? 'null'} rows=${rowsAffected}`);
      await _recordEvent('TRADE_CLOSE_PERSISTED', { bot_trade_ref: botTradeRef, symbol: symbolUpper, venue, close_source: closeSource });

      // ── Persiste ordem de fechamento (best-effort) ───────────────────────
      // Registrada apenas quando bot_trade_ref está disponível — garante ligação
      // correta ao trade pai sem ambiguidade.
      // side='CLOSE' indica ordem de saída (independente de LONG/SHORT original).
      // order_id e trade_id não estão disponíveis neste contexto sem tocar nos callers.
      if (botTradeRef != null) {
        await _insertOrder({
          bot_trade_ref: botTradeRef,
          order_id:      null,   // exchange close order ID não é passado pelos callers atuais
          trade_id:      tradeId ?? null,
          venue,
          symbol:        symbolUpper,
          side:          'CLOSE',
          size:          null,
          price:         exit_price,
          status:        'FILLED',
        });
        logger.info(`[PERSIST] Close order registrada — ref=${botTradeRef} venue=${venue} symbol=${symbolUpper} price=${exit_price}`);
      }
      // ─────────────────────────────────────────────────────────────────────
    } else {
      logger.warn(`[PERSIST] Trade close update afetou 0 rows — venue=${venue} symbol=${symbolUpper} ref=${botTradeRef ?? tradeId ?? 'fallback'}`);
      await _recordEvent('TRADE_PERSIST_FAILED', { bot_trade_ref: botTradeRef, symbol: symbolUpper, venue, error: 'UPDATE trades afetou 0 rows' });
    }
  },

  /**
   * Retorna todos os registros auditáveis vinculados a um bot_trade_ref.
   * Leitura pura — nunca modifica dados.
   * Retorna null se botTradeRef for vazio ou se o pool estiver indisponível.
   * Cada sub-array é [] quando a tabela não contém registros para o ref.
   *
   * @param {string} botTradeRef
   * @returns {Promise<{
   *   bot_trade_ref: string,
   *   trade: object|null,
   *   events: object[],
   *   orders: object[],
   *   balance_snapshots: object[],
   *   signal_decisions: object[]
   * }|null>}
   */
  async getMetricsSummary(rawMode) {
    const ZERO = { totalTrades: 0, closedTrades: 0, winRate: 0, totalPnL: 0, avgPnL: 0, bestTrade: 0, worstTrade: 0 };

    const mode = _resolveMode(rawMode);
    const { modeFilter, params } = _modeFilter(mode);

    const result = await safeQuery(`
      SELECT
        (SELECT COUNT(*)::int FROM trades WHERE TRUE ${modeFilter})                AS total_trades,
        COUNT(*)::int                                                               AS closed_trades,
        COUNT(*) FILTER (WHERE realized_pnl > 0)::int                              AS winning_trades,
        COALESCE(SUM(realized_pnl), 0)::float                                      AS total_pnl,
        COALESCE(AVG(realized_pnl), 0)::float                                      AS avg_pnl,
        COALESCE(MAX(realized_pnl), 0)::float                                      AS best_trade,
        COALESCE(MIN(realized_pnl), 0)::float                                      AS worst_trade
      FROM trades
      WHERE status = 'CLOSED' AND realized_pnl IS NOT NULL ${modeFilter}
    `, params);

    if (!result?.rows?.[0]) return ZERO;

    const r = result.rows[0];
    const closedTrades = r.closed_trades ?? 0;
    const winRate = closedTrades > 0 ? (r.winning_trades / closedTrades) * 100 : 0;

    return {
      totalTrades:  r.total_trades  ?? 0,
      closedTrades,
      winRate:      Math.round(winRate * 100) / 100,
      totalPnL:     r.total_pnl     ?? 0,
      avgPnL:       r.avg_pnl       ?? 0,
      bestTrade:    r.best_trade    ?? 0,
      worstTrade:   r.worst_trade   ?? 0,
    };
  },

  async getRiskMetrics(rawMode) {
    const ZERO = { win_rate: 0, avg_win: 0, avg_loss: 0, profit_factor: null, payoff_ratio: null };

    const mode = _resolveMode(rawMode);
    const { modeFilter, params } = _modeFilter(mode);

    const result = await safeQuery(`
      SELECT
        COUNT(*)::int                                                                    AS closed_trades,
        COUNT(*) FILTER (WHERE realized_pnl > 0)::int                                   AS winning_trades,
        COALESCE(AVG(realized_pnl) FILTER (WHERE realized_pnl > 0), 0)::float           AS avg_win,
        COALESCE(AVG(realized_pnl) FILTER (WHERE realized_pnl < 0), 0)::float           AS avg_loss,
        COALESCE(SUM(realized_pnl) FILTER (WHERE realized_pnl > 0), 0)::float           AS sum_wins,
        COALESCE(ABS(SUM(realized_pnl) FILTER (WHERE realized_pnl < 0)), 0)::float      AS abs_sum_losses
      FROM trades
      WHERE status = 'CLOSED' AND realized_pnl IS NOT NULL ${modeFilter}
    `, params);

    if (!result?.rows?.[0]) return ZERO;

    const r = result.rows[0];
    const closed = r.closed_trades ?? 0;
    if (closed === 0) return ZERO;

    const winRate      = Math.round((r.winning_trades / closed) * 100 * 100) / 100;
    const profitFactor = r.abs_sum_losses > 0 ? Math.round((r.sum_wins / r.abs_sum_losses) * 100) / 100 : null;
    const payoffRatio  = r.avg_loss < 0 ? Math.round((r.avg_win / Math.abs(r.avg_loss)) * 100) / 100 : null;

    return {
      win_rate:      winRate,
      avg_win:       Math.round((r.avg_win  ?? 0) * 100) / 100,
      avg_loss:      Math.round((r.avg_loss ?? 0) * 100) / 100,
      profit_factor: profitFactor,
      payoff_ratio:  payoffRatio,
    };
  },

  async getMetricsDistribution(rawMode) {
    const BUCKETS = ['< -100', '-100 a 0', '0 a 100', '100 a 250', '> 250'];

    const mode = _resolveMode(rawMode);
    const { modeFilter, params } = _modeFilter(mode);

    const result = await safeQuery(`
      SELECT
        CASE
          WHEN realized_pnl < -100 THEN 1
          WHEN realized_pnl < 0    THEN 2
          WHEN realized_pnl < 100  THEN 3
          WHEN realized_pnl < 250  THEN 4
          ELSE                          5
        END::int   AS bucket_order,
        CASE
          WHEN realized_pnl < -100 THEN '< -100'
          WHEN realized_pnl < 0    THEN '-100 a 0'
          WHEN realized_pnl < 100  THEN '0 a 100'
          WHEN realized_pnl < 250  THEN '100 a 250'
          ELSE                          '> 250'
        END        AS bucket,
        COUNT(*)::int AS count
      FROM trades
      WHERE status = 'CLOSED'
        AND realized_pnl IS NOT NULL
        ${modeFilter}
      GROUP BY bucket_order, bucket
      ORDER BY bucket_order ASC
    `, params);

    // Garante todos os 5 buckets mesmo se count=0 (determinístico)
    const countMap = new Map((result?.rows ?? []).map(r => [r.bucket, r.count ?? 0]));
    return BUCKETS.map(bucket => ({ bucket, count: countMap.get(bucket) ?? 0 }));
  },

  async getMetricsBySide(rawMode) {
    const mode = _resolveMode(rawMode);
    const { modeFilter, params } = _modeFilter(mode);

    const result = await safeQuery(`
      SELECT
        side,
        COUNT(*)::int                                 AS total_trades,
        COALESCE(SUM(realized_pnl), 0)::float         AS pnl,
        COUNT(*) FILTER (WHERE realized_pnl > 0)::int AS winning_trades
      FROM trades
      WHERE status = 'CLOSED'
        AND realized_pnl IS NOT NULL
        ${modeFilter}
      GROUP BY side
      ORDER BY side ASC
    `, params);

    if (!result?.rows?.length) return [];

    return result.rows.map(row => ({
      side:         row.side,
      total_trades: row.total_trades ?? 0,
      pnl:          Math.round((row.pnl ?? 0) * 100) / 100,
      win_rate:     row.total_trades > 0
        ? Math.round((row.winning_trades / row.total_trades) * 100 * 100) / 100
        : 0,
    }));
  },

  async getMetricsBySymbol(rawMode) {
    const mode = _resolveMode(rawMode);
    const { modeFilter, params } = _modeFilter(mode);

    const result = await safeQuery(`
      SELECT
        symbol,
        COUNT(*)::int                                 AS total_trades,
        COALESCE(SUM(realized_pnl), 0)::float         AS total_pnl,
        COALESCE(AVG(realized_pnl), 0)::float         AS avg_pnl,
        COUNT(*) FILTER (WHERE realized_pnl > 0)::int AS winning_trades
      FROM trades
      WHERE status = 'CLOSED'
        AND realized_pnl IS NOT NULL
        ${modeFilter}
      GROUP BY symbol
      ORDER BY total_pnl DESC
    `, params);

    if (!result?.rows?.length) return [];

    return result.rows.map(row => ({
      symbol:       row.symbol,
      total_trades: row.total_trades ?? 0,
      total_pnl:    Math.round((row.total_pnl ?? 0) * 100) / 100,
      avg_pnl:      Math.round((row.avg_pnl ?? 0) * 100) / 100,
      win_rate:     row.total_trades > 0
        ? Math.round((row.winning_trades / row.total_trades) * 100 * 100) / 100
        : 0,
    }));
  },

  async getPnlTimeseries(rawMode) {
    const mode = _resolveMode(rawMode);
    const { modeFilter, params } = _modeFilter(mode);

    const result = await safeQuery(`
      SELECT
        DATE(closed_at)::text    AS date,
        SUM(realized_pnl)::float AS daily_pnl
      FROM trades
      WHERE status = 'CLOSED'
        AND realized_pnl IS NOT NULL
        AND closed_at IS NOT NULL
        ${modeFilter}
      GROUP BY DATE(closed_at)
      ORDER BY DATE(closed_at) ASC
    `, params);

    if (!result?.rows?.length) return [];

    let cumulative = 0;
    return result.rows.map(row => {
      cumulative += row.daily_pnl ?? 0;
      return {
        date:           row.date,
        daily_pnl:      Math.round((row.daily_pnl ?? 0) * 100) / 100,
        cumulative_pnl: Math.round(cumulative * 100) / 100,
      };
    });
  },

  // ── Idempotência de notificações Telegram ──────────────────────────────────
  //
  // Fonte de verdade para deduplicação de alertas entre restarts.
  // Tabela: telegram_notifications_sent (dedupe_key TEXT UNIQUE)
  //
  // Dedupe keys usadas pelo position_tracker:
  //   <bot_trade_ref>:position_opened
  //   <bot_trade_ref>:milestone:<value>   (ex: :milestone:10, :milestone:-20)
  //
  // Todas as funções são tolerantes a falha: safeQuery absorve erros silenciosamente.
  // Se dedupeKey for null/undefined, comportamento é seguro (sem escrita/leitura no DB).

  async hasNotificationBeenSent(dedupeKey) {
    if (!dedupeKey) return false;
    const r = await safeQuery(
      'SELECT 1 FROM telegram_notifications_sent WHERE dedupe_key = $1 LIMIT 1',
      [dedupeKey]
    );
    return (r?.rowCount ?? 0) > 0;
  },

  async markNotificationSent(dedupeKey) {
    if (!dedupeKey) return;
    await safeQuery(
      'INSERT INTO telegram_notifications_sent (dedupe_key) VALUES ($1) ON CONFLICT (dedupe_key) DO NOTHING',
      [dedupeKey]
    );
  },

  async getSentMilestones(botTradeRef) {
    if (!botTradeRef) return new Set();
    const r = await safeQuery(
      `SELECT dedupe_key FROM telegram_notifications_sent WHERE dedupe_key LIKE $1`,
      [`${botTradeRef}:milestone:%`]
    );
    const set = new Set();
    for (const row of r?.rows ?? []) {
      const raw = row.dedupe_key.split(':milestone:')[1];
      const n   = Number(raw);
      if (!isNaN(n)) set.add(n);
    }
    return set;
  },

  /**
   * Retorna trades CLOSED recentemente sem exit_price.
   * Usado pelo enrichment pass do serviço de reconciliação para tentar
   * preencher exit_price / realized_pnl / closed_at com dados reais da venue.
   *
   * Exclui paper trades e trades sem closed_at.
   * windowHours limita a busca a trades fechados nas últimas N horas,
   * evitando reprocessamento de registros antigos indefinidamente.
   *
   * Nunca lança exceção — retorna [] se banco indisponível.
   *
   * @param {number} [windowHours=2]
   * @returns {Promise<Array<{id, symbol, venue, mode, bot_trade_ref, opened_at, closed_at}>>}
   */
  async getRecentlyClosedWithoutPrice(windowHours = 2) {
    const result = await safeQuery(
      `SELECT id, symbol, venue, mode, bot_trade_ref, opened_at, closed_at
       FROM trades
       WHERE status = 'CLOSED'
         AND exit_price IS NULL
         AND mode != 'paper'
         AND closed_at IS NOT NULL
         AND closed_at > NOW() - ($1 || ' hours')::interval
       ORDER BY closed_at DESC`,
      [String(windowHours)]
    );
    return result?.rows ?? [];
  },

  /**
   * Enriquece um trade CLOSED com exit_price, realized_pnl e closed_at
   * quando disponíveis via dados reais da venue.
   *
   * Segurança:
   *   - Só atualiza se exit_price IS NULL (nunca sobrescreve dados de closes controlados)
   *   - Só atualiza se o trade ainda estiver com status CLOSED
   *   - Requer tradeId (UUID do banco) — identificador inequívoco
   *
   * Nunca lança exceção.
   *
   * @param {string} tradeId       — UUID do registro em trades
   * @param {{ exit_price: number, realized_pnl: number, closed_at: string }} enrichData
   * @returns {Promise<boolean>}   — true se a linha foi atualizada
   */
  async enrichTradeClosed(tradeId, { exit_price, realized_pnl, closed_at } = {}) {
    if (!tradeId) return false;
    if (exit_price == null || !Number.isFinite(Number(exit_price)) || Number(exit_price) <= 0) {
      logger.warn(`[PERSIST] enrichTradeClosed ignorado — exit_price inválido (${exit_price}) para trade ${tradeId}`);
      return false;
    }

    const result = await safeQuery(
      `UPDATE trades
       SET exit_price   = $2,
           realized_pnl = $3,
           closed_at    = COALESCE($4::timestamptz, closed_at)
       WHERE id         = $1
         AND status     = 'CLOSED'
         AND exit_price IS NULL`,
      [
        tradeId,
        exit_price,
        realized_pnl ?? null,
        closed_at    ?? null,
      ]
    );

    const updated = (result?.rowCount ?? 0) > 0;
    if (updated) {
      logger.info(`[PERSIST] Trade enriquecido — id=${tradeId} exit_price=${exit_price} realized_pnl=${realized_pnl} closed_at=${closed_at}`);
    }
    return updated;
  },

  /**
   * Retorna todos os trades com status=OPEN no banco.
   * Usado pelo serviço de reconciliação periódica para detectar
   * posições fechadas na venue mas ainda abertas no banco.
   * Nunca lança exceção — retorna [] se banco indisponível.
   *
   * @returns {Promise<Array<{id, symbol, venue, mode, bot_trade_ref, opened_at}>>}
   */
  async getOpenTrades() {
    const result = await safeQuery(
      `SELECT id, symbol, venue, mode, bot_trade_ref, opened_at, side, entry_price
       FROM trades
       WHERE status = 'OPEN'
       ORDER BY opened_at ASC`,
      []
    );
    return result?.rows ?? [];
  },

  /**
   * Registra uma posição aberta externamente (manualmente na venue) como novo trade
   * OPEN no banco, adotando-a para controle pelo bot.
   *
   * Chamado pelo serviço de reconciliação quando detecta posição aberta na venue
   * sem correspondente OPEN no banco.
   *
   * Efeitos:
   *   - INSERT em trades (status=OPEN, source='system')
   *   - _botTradeRefs e _openTradeIds atualizados em memória
   *   - trade_events com open_source='venue_reconciliation' no payload
   *
   * Idempotência: responsabilidade do caller verificar que não há OPEN para venue+asset.
   * Nunca lança exceção — safeQuery absorve falhas silenciosamente.
   *
   * @param {object} livePos
   * @param {string}      livePos.asset
   * @param {string}      livePos.venue
   * @param {string}      livePos.direction  - 'LONG' | 'SHORT' (obrigatório)
   * @param {number|null} [livePos.entryPrice]
   * @param {number|null} [livePos.sizeBase]
   * @returns {Promise<{id: string, bot_trade_ref: string}|null>}
   */
  async recordExternalTradeAdopted(livePos) {
    const { asset, venue, direction, entryPrice = null, sizeBase = null } = livePos;
    const symbolUpper = asset?.toUpperCase();

    if (!symbolUpper || !venue) {
      logger.warn('[PERSIST] recordExternalTradeAdopted: asset e venue são obrigatórios');
      return null;
    }

    const sideUpper = direction?.toUpperCase();
    if (!sideUpper || !['LONG', 'SHORT'].includes(sideUpper)) {
      logger.warn(`[PERSIST] recordExternalTradeAdopted: direction inválida (${direction}) para ${venue}:${symbolUpper}`);
      return null;
    }

    const mapKey = `${venue}:${symbolUpper}`;
    const ref    = randomUUID();

    // Register ref before INSERT — available for positions:update listener even if INSERT is slow
    const prevRef = _botTradeRefs.get(mapKey) ?? null;
    _botTradeRefs.set(mapKey, ref);

    await _recordEvent('TRADE_OPEN_REQUESTED', {
      bot_trade_ref: ref,
      symbol:        symbolUpper,
      venue,
      mode:          'live',
      open_source:   'venue_reconciliation',
    });

    const sizeUSD = (entryPrice != null && sizeBase != null && entryPrice > 0 && sizeBase > 0)
      ? entryPrice * sizeBase
      : null;

    const result = await safeQuery(
      `INSERT INTO trades (
         bot_trade_ref, symbol, side, status, mode, source, venue,
         entry_price, size
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id`,
      [
        ref,
        symbolUpper,
        sideUpper,
        'OPEN',
        'live',
        'system',
        venue,
        entryPrice ?? null,
        sizeUSD    ?? null,
      ]
    );

    const id = result?.rows?.[0]?.id ?? null;

    if (id != null) {
      _openTradeIds.set(mapKey, id);
      logger.warn(
        `[PERSIST] ✅ Trade externo adotado — id=${id} ref=${ref} venue=${venue} symbol=${symbolUpper} side=${sideUpper} entry=${entryPrice ?? 'N/A'}`,
        { event: 'trade_external_adopted', id, bot_trade_ref: ref, venue, symbol: symbolUpper, side: sideUpper, entry_price: entryPrice }
      );
      await _recordEvent('TRADE_OPEN_PERSISTED', {
        bot_trade_ref: ref,
        symbol:        symbolUpper,
        venue,
        mode:          'live',
        open_source:   'venue_reconciliation',
      });
      return { id, bot_trade_ref: ref };
    }

    // INSERT failed — restore previous ref state
    if (_botTradeRefs.get(mapKey) === ref) {
      if (prevRef != null) {
        _botTradeRefs.set(mapKey, prevRef);
      } else {
        _botTradeRefs.delete(mapKey);
      }
    }
    await _recordEvent('TRADE_PERSIST_FAILED', {
      bot_trade_ref: ref,
      symbol:        symbolUpper,
      venue,
      mode:          'live',
      error:         'INSERT trades retornou null id (adoção externa)',
    });
    logger.warn(`[PERSIST] recordExternalTradeAdopted falhou — INSERT retornou null para ${venue}:${symbolUpper}`);
    return null;
  },

  async getTradeAuditByRef(botTradeRef) {
    if (!botTradeRef) return null;

    const [tradeRes, eventsRes, ordersRes, balanceRes, decisionsRes] = await Promise.all([
      safeQuery(`SELECT * FROM trades           WHERE bot_trade_ref = $1 LIMIT 1`,                          [botTradeRef]),
      safeQuery(`SELECT * FROM trade_events     WHERE bot_trade_ref = $1 ORDER BY created_at ASC`,           [botTradeRef]),
      safeQuery(`SELECT * FROM orders           WHERE bot_trade_ref = $1 ORDER BY created_at ASC`,           [botTradeRef]),
      safeQuery(`SELECT * FROM balance_snapshots WHERE bot_trade_ref = $1 ORDER BY created_at ASC`,          [botTradeRef]),
      safeQuery(`SELECT * FROM signal_decisions  WHERE bot_trade_ref = $1 ORDER BY created_at ASC`,          [botTradeRef]),
    ]);

    return {
      bot_trade_ref:    botTradeRef,
      trade:            tradeRes?.rows?.[0]  ?? null,
      events:           eventsRes?.rows       ?? [],
      orders:           ordersRes?.rows       ?? [],
      balance_snapshots: balanceRes?.rows     ?? [],
      signal_decisions: decisionsRes?.rows    ?? [],
    };
  },
};

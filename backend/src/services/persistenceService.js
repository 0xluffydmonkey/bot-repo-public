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
// SCHEMA DA TABELA (fonte da verdade — não alterar o código para contradizer isso):
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
// ─────────────────────────────────────────────────────────────────────────────
//
// MIGRAÇÃO — adicionar bot_trade_ref a uma tabela existente:
//   ALTER TABLE trades ADD COLUMN bot_trade_ref text unique;
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
  async recordTradeOpened(data) {
    const {
      symbol, side, mode, source, venue,
      entry_price, size, leverage,
      bot_trade_ref,
    } = data;

    const mapKey = `${venue}:${symbol.toUpperCase()}`;
    const ref    = bot_trade_ref ?? randomUUID();

    // Registra o ref imediatamente — disponível para o listener positions:update
    // mesmo que o INSERT falhe (ex: banco indisponível).
    _botTradeRefs.set(mapKey, ref);

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
    } else {
      logger.warn(`[PERSIST] Trade close update afetou 0 rows — venue=${venue} symbol=${symbolUpper} ref=${botTradeRef ?? tradeId ?? 'fallback'}`);
    }
  },
};

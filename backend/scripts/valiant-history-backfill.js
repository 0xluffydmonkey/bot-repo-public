#!/usr/bin/env node
// scripts/valiant-history-backfill.js
//
// STANDALONE historical backfill script for Valiant/Hyperliquid trades.
// NOT part of the bot runtime. Must be executed manually.
// Does NOT start on boot. Does NOT touch live bot state.
//
// ── Usage ────────────────────────────────────────────────────────────────────
//
//   BOT_SECRETS_FILE=/opt/bot/secrets/bot-secrets.env \
//     node scripts/valiant-history-backfill.js \
//     --mode=audit \
//     --from=2026-03-17 \
//     [--to=2026-04-20] \
//     [--asset=SOL]
//
// ── Modes ────────────────────────────────────────────────────────────────────
//
//   audit         — read-only: compares Valiant fills vs DB, shows full report
//   dry-run       — simulates the full consolidation plan, writes nothing
//   merge         — inserts missing historical trades (idempotent, conservative)
//   reset-rebuild — DESTRUCTIVE: clears valiant trades, rebuilds from fills
//                   Requires: --yes-i-know-what-i-am-doing
//   repair        — fixes opened_at/closed_at on already-imported backfill trades
//                   Requires: --yes-i-know-what-i-am-doing
//
// ── Required env vars ────────────────────────────────────────────────────────
//
//   VALIANT_ACCOUNT_ADDRESS  — Hyperliquid account address (read-only, no key needed)
//   SUPABASE_DB_URL_PATH     — path to file containing the PostgreSQL connection string
//   VALIANT_BASE_URL         — (optional) Hyperliquid API base URL

import { readFileSync }  from 'fs';
import { createHash }    from 'crypto';
import { fileURLToPath } from 'url';
import path              from 'path';
import dotenv            from 'dotenv';
import pkg               from 'pg';

const { Pool } = pkg;

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

// ── Load env (same pattern as other scripts in this directory) ────────────────

const secretsPath = process.env.BOT_SECRETS_FILE?.trim();
if (secretsPath) {
  dotenv.config({ path: secretsPath });
  console.log(`[BACKFILL] Secrets loaded from: ${secretsPath}`);
}
dotenv.config({ path: path.join(backendRoot, '.env') });

// Import Hyperliquid client AFTER env is loaded.
// getUserFillsByTime only calls /info (unauthenticated read).
// It only needs VALIANT_ACCOUNT_ADDRESS — no agent key file required.
const { getUserFillsByTime } = await import('../src/trading/clients/hyperliquidClient.js');

// ── Arg parsing ───────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const result = {};
  for (const arg of argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    if (m) result[m[1]] = m[2] ?? true;
  }
  return result;
}

const args    = parseArgs(process.argv);
const MODE    = args['mode'];
const FROM    = args['from']  ?? '2026-03-17';
const TO      = args['to']    ?? new Date().toISOString().slice(0, 10);
const ASSET   = args['asset'] ? String(args['asset']).toUpperCase() : null;
const CONFIRM = args['yes-i-know-what-i-am-doing'] === true
             || args['yes-i-know-what-i-am-doing'] === 'true';

const VALID_MODES = ['audit', 'dry-run', 'merge', 'reset-rebuild', 'repair'];

// ── Validate args ─────────────────────────────────────────────────────────────

if (!MODE || !VALID_MODES.includes(MODE)) {
  console.error(`[BACKFILL] --mode é obrigatório. Valores válidos: ${VALID_MODES.join(', ')}`);
  console.error('');
  console.error('  node scripts/valiant-history-backfill.js --mode=audit    --from=2026-03-17');
  console.error('  node scripts/valiant-history-backfill.js --mode=dry-run  --from=2026-03-17 [--asset=SOL]');
  console.error('  node scripts/valiant-history-backfill.js --mode=merge    --from=2026-03-17');
  console.error('  node scripts/valiant-history-backfill.js --mode=reset-rebuild --from=2026-03-17 --yes-i-know-what-i-am-doing');
  process.exit(1);
}

if (MODE === 'reset-rebuild' && !CONFIRM) {
  console.error('[BACKFILL] ❌  --mode=reset-rebuild requer a flag explícita:');
  console.error('                --yes-i-know-what-i-am-doing');
  console.error('');
  console.error('           Este modo é DESTRUTIVO. Execute --mode=audit e --mode=dry-run primeiro.');
  process.exit(1);
}

if (MODE === 'repair' && !CONFIRM) {
  console.error('[BACKFILL] ❌  --mode=repair requer a flag explícita:');
  console.error('                --yes-i-know-what-i-am-doing');
  console.error('');
  console.error('           Este modo altera opened_at/closed_at de trades históricos já importados.');
  console.error('           Execute --mode=audit primeiro para confirmar o escopo.');
  process.exit(1);
}

const fromMs = new Date(FROM + 'T00:00:00.000Z').getTime();
const toMs   = new Date(TO   + 'T23:59:59.999Z').getTime();

if (isNaN(fromMs) || isNaN(toMs)) {
  console.error(`[BACKFILL] Datas inválidas: from="${FROM}" to="${TO}"`);
  process.exit(1);
}

if (fromMs > toMs) {
  console.error('[BACKFILL] --from deve ser anterior a --to');
  process.exit(1);
}

// ── DB Pool ───────────────────────────────────────────────────────────────────

function createDbPool() {
  const pathVar  = 'SUPABASE_DB_URL_PATH';
  const filePath = process.env[pathVar]?.trim();
  if (!filePath) {
    throw new Error(`${pathVar} não definido. Configure no BOT_SECRETS_FILE ou variável de ambiente.`);
  }
  let connectionString;
  try {
    connectionString = readFileSync(filePath, 'utf-8').trim();
  } catch (err) {
    throw new Error(`Não foi possível ler ${pathVar} em "${filePath}": ${err.message}`);
  }
  if (!connectionString) {
    throw new Error(`Arquivo ${pathVar} está vazio: "${filePath}"`);
  }
  const pool = new Pool({
    connectionString,
    ssl:                     { rejectUnauthorized: false },
    max:                     3,
    idleTimeoutMillis:       30_000,
    connectionTimeoutMillis: 5_000,
  });
  pool.on('error', (err) => console.error(`[BACKFILL] Pool error (não fatal): ${err.message}`));
  return pool;
}

// ── Deterministic UUID ────────────────────────────────────────────────────────
// Idempotency: same historical fill set → same bot_trade_ref → ON CONFLICT
// on trades.bot_trade_ref (UNIQUE) prevents duplicate inserts across merge runs.

function deterministicUuid(seed) {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20,32)}`;
}

// ── Fill normalization ────────────────────────────────────────────────────────

function normalizeCoin(coin) {
  return (coin ?? '').replace(/-PERP$/i, '').toUpperCase().trim();
}

// "Open Long" | "Close Long" | "Open Short" | "Close Short"
function sideFromDir(dir) {
  if (!dir) return null;
  if (dir.includes('Long'))  return 'LONG';
  if (dir.includes('Short')) return 'SHORT';
  return null;
}
function isOpenDir(dir)  { return typeof dir === 'string' && dir.startsWith('Open');  }
function isCloseDir(dir) { return typeof dir === 'string' && dir.startsWith('Close'); }

function weightedAvgPrice(fills) {
  if (!fills.length) return null;
  let sumSz = 0, sumPxSz = 0;
  for (const f of fills) {
    const sz = parseFloat(f.sz ?? '0');
    const px = parseFloat(f.px ?? '0');
    sumSz   += sz;
    sumPxSz += px * sz;
  }
  return sumSz > 0 ? sumPxSz / sumSz : null;
}
function sumSize(fills) {
  return fills.reduce((acc, f) => acc + parseFloat(f.sz    ?? '0'), 0);
}
function sumClosedPnl(fills) {
  return fills.reduce((acc, f) => acc + parseFloat(f.closedPnl ?? '0'), 0);
}

// ── Fill → logical trade consolidation ───────────────────────────────────────
//
// State machine per asset (chronological walk):
//   "Open *"  → start new session, or extend (scale-in), or flip
//   "Close *" → append to current session; finalize when size matches
//
// Ambiguity cases (NOT persisted automatically in merge):
//   orphan_close        — close fill with no preceding open
//   flip_before_full_close — new opposite-side open before full close
//   close_side_mismatch — close direction does not match open side

function consolidateFills(fills) {
  const byCoin = new Map();
  for (const f of fills) {
    const coin = normalizeCoin(f.coin);
    if (!byCoin.has(coin)) byCoin.set(coin, []);
    byCoin.get(coin).push(f);
  }

  const logicalTrades = [];

  for (const [coin, coinFills] of byCoin) {
    if (ASSET && coin !== ASSET) continue;
    coinFills.sort((a, b) => a.time - b.time);

    let current = null;

    for (const fill of coinFills) {
      const side = sideFromDir(fill.dir);
      if (!side) continue;

      if (isOpenDir(fill.dir)) {
        if (current === null) {
          current = _newSession(coin, side, fill);
        } else if (current.side === side) {
          // Scale-in: add to existing session
          current.fills_open.push(fill);
        } else {
          // Flip: opposite side arrived while session still open
          const openSz  = sumSize(current.fills_open);
          const closeSz = sumSize(current.fills_close);
          if (closeSz < openSz * 0.99) {
            current.ambiguous        = true;
            current.ambiguous_reason = `flip_before_full_close (open=${openSz.toFixed(4)} closed=${closeSz.toFixed(4)})`;
          }
          logicalTrades.push(_finalizeSession(current));
          current = _newSession(coin, side, fill);
        }

      } else if (isCloseDir(fill.dir)) {
        if (current === null) {
          // Orphan close — no open session to match
          logicalTrades.push({
            symbol:           coin,
            side,
            fills_open:       [],
            fills_close:      [fill],
            ambiguous:        true,
            ambiguous_reason: 'orphan_close_no_open',
            status:           'CLOSED',
            entry_price:      null,
            exit_price:       parseFloat(fill.px ?? '0') || null,
            size_base:        0,
            size_usd:         null,
            realized_pnl:     parseFloat(fill.closedPnl ?? '0'),
            opened_at:        null,
            closed_at:        new Date(fill.time).toISOString(),
            bot_trade_ref:    null,
          });
          continue;
        }
        if (current.side !== side) {
          current.ambiguous        = true;
          current.ambiguous_reason = `close_side_mismatch (open=${current.side} close=${side})`;
        }
        current.fills_close.push(fill);

        const openSz  = sumSize(current.fills_open);
        const closeSz = sumSize(current.fills_close);
        if (closeSz >= openSz * 0.999) {
          logicalTrades.push(_finalizeSession(current));
          current = null;
        }
      }
    }

    if (current !== null) {
      logicalTrades.push(_finalizeSession(current, 'OPEN'));
    }
  }

  return logicalTrades;
}

function _newSession(symbol, side, firstFill) {
  return { symbol, side, fills_open: [firstFill], fills_close: [], ambiguous: false, ambiguous_reason: null };
}

function _finalizeSession(session, forceStatus = null) {
  const entry_price  = weightedAvgPrice(session.fills_open);
  const exit_price   = weightedAvgPrice(session.fills_close);
  const size_base    = sumSize(session.fills_open);
  const realized_pnl = sumClosedPnl(session.fills_close);

  const openTimes  = session.fills_open.map(f  => f.time);
  const closeTimes = session.fills_close.map(f => f.time);

  const opened_at = openTimes.length  > 0 ? new Date(Math.min(...openTimes)).toISOString()  : null;
  const closed_at = closeTimes.length > 0 ? new Date(Math.max(...closeTimes)).toISOString() : null;

  const openSz  = size_base;
  const closeSz = sumSize(session.fills_close);
  const status  = forceStatus ?? (closeSz >= openSz * 0.999 ? 'CLOSED' : 'OPEN');

  // Deterministic ref from the first fill's exchange trade id (tid).
  // Ensures idempotency across multiple merge runs.
  const firstFill      = session.fills_open[0] ?? session.fills_close[0];
  const refSeed        = `valiant-backfill:${session.symbol}:${session.side}:${firstFill?.tid ?? firstFill?.hash ?? 'unknown'}`;
  const bot_trade_ref  = deterministicUuid(refSeed);

  return {
    ...session,
    status,
    entry_price,
    exit_price,
    size_base,
    size_usd:      entry_price != null && size_base > 0 ? entry_price * size_base : null,
    realized_pnl,
    opened_at,
    closed_at,
    bot_trade_ref,
  };
}

// ── DB read helpers ───────────────────────────────────────────────────────────

async function getDbValiantTrades(pool) {
  const res = await pool.query(
    `SELECT id, bot_trade_ref, symbol, side, status, mode, entry_price, exit_price,
            size, leverage, realized_pnl, opened_at, closed_at, created_at, source
     FROM trades
     WHERE venue = 'valiant'
     ORDER BY opened_at ASC NULLS LAST`,
    []
  );
  return res.rows;
}

async function getDbValiantCounts(pool) {
  const res = await pool.query(
    `SELECT
       COUNT(*)                                           ::int AS total_valiant,
       COUNT(*) FILTER (WHERE status = 'OPEN')            ::int AS open_valiant,
       COUNT(*) FILTER (WHERE status = 'CLOSED')          ::int AS closed_valiant,
       COUNT(*) FILTER (WHERE mode   = 'live')            ::int AS live_valiant,
       COUNT(*) FILTER (WHERE mode   = 'paper')           ::int AS paper_valiant
     FROM trades
     WHERE venue = 'valiant'`,
    []
  );
  return res.rows[0];
}

async function getRelatedCounts(pool) {
  const res = await pool.query(
    `SELECT
       (SELECT COUNT(*) FROM trade_events      te
        JOIN trades t ON t.bot_trade_ref = te.bot_trade_ref
        WHERE t.venue = 'valiant')::int   AS events,
       (SELECT COUNT(*) FROM orders           o
        JOIN trades t ON t.bot_trade_ref = o.bot_trade_ref
        WHERE t.venue = 'valiant')::int   AS orders,
       (SELECT COUNT(*) FROM balance_snapshots bs
        JOIN trades t ON t.bot_trade_ref = bs.bot_trade_ref
        WHERE t.venue = 'valiant')::int   AS balance_snapshots,
       (SELECT COUNT(*) FROM signal_decisions  sd
        JOIN trades t ON t.bot_trade_ref = sd.bot_trade_ref
        WHERE t.venue = 'valiant')::int   AS signal_decisions`,
    []
  );
  return res.rows[0];
}

// ── Historical ↔ DB matching ──────────────────────────────────────────────────
// Conservative: symbol + side + temporal window + optional price proximity.
// Returns: { match, confidence: 'high'|'ambiguous'|'none', allMatches? }

const TEMPORAL_WINDOW_MS = 4 * 60 * 60 * 1000; // ±4 hours
const PRICE_TOLERANCE    = 0.05;               // ±5%

function findDbMatch(ht, dbTrades) {
  if (!ht.opened_at) return { match: null, confidence: 'none' };

  const hTs = new Date(ht.opened_at).getTime();

  const candidates = dbTrades.filter(db => {
    if (db.symbol !== ht.symbol) return false;
    if (db.side   !== ht.side)   return false;
    const dbTs = db.opened_at ? new Date(db.opened_at).getTime() : null;
    if (dbTs == null || Math.abs(dbTs - hTs) > TEMPORAL_WINDOW_MS) return false;
    if (ht.entry_price != null && db.entry_price != null) {
      const diff = Math.abs(ht.entry_price - parseFloat(db.entry_price)) / ht.entry_price;
      if (diff > PRICE_TOLERANCE) return false;
    }
    return true;
  });

  if (candidates.length === 0) return { match: null, confidence: 'none' };
  if (candidates.length === 1) return { match: candidates[0], confidence: 'high' };
  return { match: candidates[0], confidence: 'ambiguous', allMatches: candidates };
}

// ── Formatting helpers ────────────────────────────────────────────────────────

function sep(char = '─', w = 72)  { console.log(char.repeat(w)); }
function header(title) { sep('═'); console.log(`  ${title}`); sep('═'); }
function section(title) { console.log(''); sep(); console.log(`  ${title}`); sep(); }

function fmtPrice(v) { return v != null ? `$${parseFloat(v).toFixed(4)}`  : 'N/A'; }
function fmtPnl(v)   { return v != null ? `$${parseFloat(v).toFixed(2)}`  : 'N/A'; }
function fmtDate(v)  {
  if (!v) return 'N/A';
  return new Date(v).toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
}
function fmtStatus(s) {
  if (s === 'CLOSED') return '✓ CLOSED';
  if (s === 'OPEN')   return '◷ OPEN  ';
  return s ?? 'N/A';
}

// ── INSERT helpers ────────────────────────────────────────────────────────────

// ::timestamptz ensures PostgreSQL parses the ISO string (with "Z" suffix) unambiguously
// regardless of session timezone. For `timestamp` columns, PostgreSQL then converts from UTC
// to session tz — which is UTC in Supabase, so the stored value equals the historical time.
const INSERT_TRADE_SQL = `
  INSERT INTO trades (
    bot_trade_ref, symbol, side, status, mode, source, venue,
    entry_price, exit_price, size, leverage, realized_pnl,
    opened_at, closed_at
  ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz)
  ON CONFLICT (bot_trade_ref) DO NOTHING
  RETURNING id`;

function tradeParams(t) {
  return [
    t.bot_trade_ref,
    t.symbol,
    t.side,
    t.status,
    'live',
    'system',
    'valiant',
    t.entry_price  ?? null,
    t.exit_price   ?? null,
    t.size_usd     ?? null,   // notional (entry_price * size_base); leverage unknown from fills
    null,                     // leverage: not derivable from fill data
    t.realized_pnl ?? null,
    t.opened_at    ?? null,
    t.closed_at    ?? null,
  ];
}

// occurred_at uses the historical trade timestamp so audit events reflect when the trade
// actually happened on the venue, not when the backfill script was executed.
// COALESCE(..., NOW()) guards against null (e.g. orphan closes with no open fills).
async function insertTradeEvents(client, t) {
  const openPayload = JSON.stringify({
    symbol:           t.symbol,
    venue:            'valiant',
    mode:             'live',
    open_source:      'historical_backfill',
    fills_count_open: t.fills_open.length,
  });
  await client.query(
    `INSERT INTO trade_events (event_type, bot_trade_ref, payload, occurred_at)
     VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, NOW()))`,
    ['TRADE_OPEN_PERSISTED', t.bot_trade_ref, openPayload, t.opened_at ?? null]
  );
  if (t.status === 'CLOSED') {
    const closePayload = JSON.stringify({
      symbol:            t.symbol,
      venue:             'valiant',
      mode:              'live',
      close_source:      'historical_backfill',
      fills_count_close: t.fills_close.length,
    });
    await client.query(
      `INSERT INTO trade_events (event_type, bot_trade_ref, payload, occurred_at)
       VALUES ($1, $2, $3::jsonb, COALESCE($4::timestamptz, NOW()))`,
      ['TRADE_CLOSE_PERSISTED', t.bot_trade_ref, closePayload, t.closed_at ?? null]
    );
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// MAIN
// ═════════════════════════════════════════════════════════════════════════════

header(`VALIANT HISTORY BACKFILL — mode=${MODE}`);
console.log(`  from:  ${FROM}  →  ${new Date(fromMs).toISOString()}`);
console.log(`  to:    ${TO}    →  ${new Date(toMs).toISOString()}`);
console.log(`  asset: ${ASSET ?? '(all)'}`);
sep();

// ── Step 1: Fetch fills ───────────────────────────────────────────────────────

console.log('');
console.log('[1/4] Fetching fills from Hyperliquid...');
let rawFills;
try {
  rawFills = await getUserFillsByTime(fromMs, toMs);
} catch (err) {
  console.error(`[BACKFILL] ❌ Falha ao buscar fills da Hyperliquid: ${err.message}`);
  process.exit(1);
}

const filteredFills = ASSET
  ? rawFills.filter(f => normalizeCoin(f.coin) === ASSET)
  : rawFills;

console.log(`      ✓ ${rawFills.length} fills recebidos (${filteredFills.length} após filtro de asset)`);

// ── Step 2: Consolidate ───────────────────────────────────────────────────────

console.log('[2/4] Consolidando fills em trades lógicos...');
const allHistorical  = consolidateFills(filteredFills);
const ambiguousTrades = allHistorical.filter(t => t.ambiguous);
const cleanTrades     = allHistorical.filter(t => !t.ambiguous);
const openClean       = cleanTrades.filter(t => t.status === 'OPEN');
const closedClean     = cleanTrades.filter(t => t.status === 'CLOSED');

console.log(`      ✓ ${allHistorical.length} trades consolidados`);
console.log(`        ${closedClean.length} fechados | ${openClean.length} abertos | ${ambiguousTrades.length} ambíguos (ignorados)`);

// ── Step 3: Connect to DB ─────────────────────────────────────────────────────

console.log('[3/4] Conectando ao banco...');
let pool;
try {
  pool = createDbPool();
  await pool.query('SELECT 1');
  console.log('      ✓ Banco conectado');
} catch (err) {
  console.error(`[BACKFILL] ❌ Falha ao conectar ao banco: ${err.message}`);
  process.exit(1);
}

// ── Step 4: Read DB state + match ─────────────────────────────────────────────

console.log('[4/4] Lendo estado atual do banco e comparando...');
const dbTrades  = await getDbValiantTrades(pool);
const dbCounts  = await getDbValiantCounts(pool);

const matchResults = cleanTrades.map(ht => ({ historical: ht, ...findDbMatch(ht, dbTrades) }));
const noMatch      = matchResults.filter(r => r.confidence === 'none');
const highMatch    = matchResults.filter(r => r.confidence === 'high');
const multiMatch   = matchResults.filter(r => r.confidence === 'ambiguous');

// Enrichment candidates: matched trades where DB has no exit_price but fills do
const enrichCandidates = highMatch.filter(
  r => r.match.exit_price == null && r.historical.exit_price != null && r.historical.status === 'CLOSED'
);

console.log(`      ✓ ${dbTrades.length} trades lidos do banco (venue=valiant)`);
console.log(`        sem match (faltantes): ${noMatch.length} | match confiante: ${highMatch.length} | match ambíguo: ${multiMatch.length}`);

// ═════════════════════════════════════════════════════════════════════════════
// MODE: audit
// ═════════════════════════════════════════════════════════════════════════════

if (MODE === 'audit') {
  section('BANCO — ESTADO ATUAL (venue=valiant)');
  console.log(`  Total trades:          ${dbCounts.total_valiant}`);
  console.log(`  Status OPEN:           ${dbCounts.open_valiant}`);
  console.log(`  Status CLOSED:         ${dbCounts.closed_valiant}`);
  console.log(`  Mode live:             ${dbCounts.live_valiant}`);
  console.log(`  Mode paper:            ${dbCounts.paper_valiant}`);

  section('HYPERLIQUID — FILLS RECONSTRUÍDOS');
  console.log(`  Total fills no período:    ${filteredFills.length}`);
  console.log(`  Trades lógicos limpos:     ${cleanTrades.length}`);
  console.log(`    ↳ abertos:               ${openClean.length}`);
  console.log(`    ↳ fechados:              ${closedClean.length}`);
  console.log(`  Trades ambíguos (ignorar): ${ambiguousTrades.length}`);

  section('COMPARAÇÃO: Histórico ↔ DB');
  console.log(`  Match confiante (já no banco):   ${highMatch.length}`);
  console.log(`  Sem match (faltam no banco):      ${noMatch.length}`);
  console.log(`  Match ambíguo (múltiplos):        ${multiMatch.length}`);
  console.log(`  Enriquecíveis (exit_price null):  ${enrichCandidates.length}`);

  if (noMatch.length > 0) {
    section('TRADES FALTANTES NO BANCO (candidatos a merge)');
    for (const r of noMatch) {
      const t = r.historical;
      console.log(
        `  ${t.symbol.padEnd(6)} ${t.side.padEnd(6)} ${fmtStatus(t.status)}  ` +
        `opened=${fmtDate(t.opened_at)}  entry=${fmtPrice(t.entry_price)}  ` +
        `pnl=${fmtPnl(t.realized_pnl)}  fills_open=${t.fills_open.length}  fills_close=${t.fills_close.length}`
      );
    }
  }

  if (multiMatch.length > 0) {
    section('MATCHES AMBÍGUOS (múltiplos candidatos no DB — não serão tocados em merge)');
    for (const r of multiMatch) {
      const t = r.historical;
      console.log(
        `  ${t.symbol.padEnd(6)} ${t.side.padEnd(6)} opened=${fmtDate(t.opened_at)}  ` +
        `→ ${r.allMatches?.length ?? '?'} candidatos no banco`
      );
    }
  }

  if (ambiguousTrades.length > 0) {
    section('TRADES AMBÍGUOS NOS FILLS (não serão persistidos automaticamente)');
    for (const t of ambiguousTrades) {
      console.log(`  ${(t.symbol ?? '?').padEnd(6)} ${(t.side ?? '?').padEnd(6)} reason=${t.ambiguous_reason}`);
    }
  }

  section('O QUE SERIA PERDIDO EM reset-rebuild');
  const relCounts = await getRelatedCounts(pool);
  console.log(`  trades             (venue=valiant, mode=live): ${dbCounts.live_valiant}`);
  console.log(`  trade_events       (vinculados):               ${relCounts.events}`);
  console.log(`  orders             (vinculados):               ${relCounts.orders}`);
  console.log(`  balance_snapshots  (vinculados):               ${relCounts.balance_snapshots}`);
  console.log(`  signal_decisions   (vinculados):               ${relCounts.signal_decisions}`);
  console.log('');
  console.log('  Tabelas NÃO afetadas por reset-rebuild:');
  console.log('    telegram_notifications_sent, configurações, secrets, paper trades');

  section('RECOMENDAÇÃO');
  if (noMatch.length === 0 && ambiguousTrades.length === 0) {
    console.log('  ✅ Banco parece completo para o período. Nenhuma lacuna detectada.');
    console.log('     merge não é necessário.');
  } else {
    if (noMatch.length > 0) {
      console.log(`  🟡 ${noMatch.length} trade(s) histórico(s) ausentes no banco.`);
      console.log('     Execute --mode=merge para inserir de forma conservadora e idempotente.');
    }
    if (ambiguousTrades.length > 0) {
      console.log(`  🟠 ${ambiguousTrades.length} trade(s) ambíguo(s) nos fills — revisar manualmente.`);
    }
    if (multiMatch.length > 0) {
      console.log(`  🟡 ${multiMatch.length} trade(s) com múltiplos candidatos no banco — revisar manualmente.`);
    }
    console.log('');
    console.log('  Sobre reset-rebuild:');
    console.log('    Só vale se merge não resolver as lacunas, ou se o banco estiver em');
    console.log('    estado inconsistente grave. Preferir merge por ser conservador e reversível.');
  }

  console.log('');
  sep('═');
  console.log('  [audit] Nenhuma alteração realizada no banco.');
  sep('═');
  console.log('');
  await pool.end();
  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════════════════
// MODE: dry-run
// ═════════════════════════════════════════════════════════════════════════════

if (MODE === 'dry-run') {
  section('DRY-RUN — Plano de execução (nada será gravado)');

  console.log('');
  console.log('  ── Plano de MERGE ──');
  console.log(`    Inserções novas:           ${noMatch.length}`);
  console.log(`    Enriquecimentos possíveis: ${enrichCandidates.length}`);
  console.log(`    Ambíguos (ignorados):      ${ambiguousTrades.length}`);
  console.log(`    Match ambíguo (ignorados): ${multiMatch.length}`);
  console.log(`    Com match (não alterados): ${highMatch.length}`);

  if (noMatch.length > 0) {
    console.log('');
    console.log('  Trades que seriam INSERIDOS em merge:');
    for (const r of noMatch) {
      const t = r.historical;
      console.log(
        `    [INSERT] ${t.symbol.padEnd(6)} ${t.side.padEnd(6)} ${fmtStatus(t.status)}  ` +
        `opened=${fmtDate(t.opened_at)}  entry=${fmtPrice(t.entry_price)}  ` +
        `exit=${fmtPrice(t.exit_price)}  pnl=${fmtPnl(t.realized_pnl)}`
      );
      console.log(`             ref=${t.bot_trade_ref}`);
    }
  }

  if (enrichCandidates.length > 0) {
    console.log('');
    console.log('  Trades que seriam ENRIQUECIDOS em merge (exit_price ausente no banco):');
    for (const { match: db, historical: ht } of enrichCandidates) {
      console.log(
        `    [ENRICH] id=${db.id}  ${db.symbol} ${db.side}  ` +
        `exit_price: null → ${fmtPrice(ht.exit_price)}  pnl: null → ${fmtPnl(ht.realized_pnl)}`
      );
    }
  }

  console.log('');
  console.log('  ── Plano de RESET-REBUILD ──');
  const relCounts = await getRelatedCounts(pool);
  console.log('  Linhas que seriam DELETADAS:');
  console.log(`    trades             (venue=valiant, mode=live): ${dbCounts.live_valiant}`);
  console.log(`    trade_events       (vinculados):               ${relCounts.events}`);
  console.log(`    orders             (vinculados):               ${relCounts.orders}`);
  console.log(`    balance_snapshots  (vinculados):               ${relCounts.balance_snapshots}`);
  console.log(`    signal_decisions   (vinculados):               ${relCounts.signal_decisions}`);
  console.log('  Linhas que seriam INSERIDAS:');
  console.log(`    trades lógicos limpos:  ${cleanTrades.length}`);
  console.log(`    (${ambiguousTrades.length} ambíguos seriam IGNORADOS)`);

  if (cleanTrades.length > 0) {
    console.log('');
    console.log('  Trades que seriam RECRIADOS em reset-rebuild:');
    for (const t of cleanTrades) {
      console.log(
        `    [REBUILD] ${t.symbol.padEnd(6)} ${t.side.padEnd(6)} ${fmtStatus(t.status)}  ` +
        `opened=${fmtDate(t.opened_at)}  entry=${fmtPrice(t.entry_price)}  pnl=${fmtPnl(t.realized_pnl)}`
      );
    }
  }

  console.log('');
  sep('═');
  console.log('  [dry-run] Nenhuma alteração realizada no banco.');
  sep('═');
  console.log('');
  await pool.end();
  process.exit(0);
}

// ═════════════════════════════════════════════════════════════════════════════
// MODE: merge
// ═════════════════════════════════════════════════════════════════════════════

if (MODE === 'merge') {
  section('MERGE — Inserção conservadora de trades faltantes');
  console.log(`  Trades a inserir:           ${noMatch.length}`);
  console.log(`  Trades a enriquecer:        ${enrichCandidates.length}`);
  console.log(`  Ambíguos ignorados:         ${ambiguousTrades.length}`);
  console.log(`  Match ambíguo ignorados:    ${multiMatch.length}`);
  console.log(`  Com match (não alterados):  ${highMatch.length}`);
  console.log('');

  let inserted = 0, enriched = 0, failed = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Insert missing trades
    for (const r of noMatch) {
      const t = r.historical;
      try {
        const res = await client.query(INSERT_TRADE_SQL, tradeParams(t));
        if (res.rowCount > 0) {
          // New insert — also record audit events
          await insertTradeEvents(client, t);
          inserted++;
          console.log(
            `  [INSERTED] ${t.symbol.padEnd(6)} ${t.side.padEnd(6)} ${fmtStatus(t.status)}  ` +
            `opened=${fmtDate(t.opened_at)}  entry=${fmtPrice(t.entry_price)}  pnl=${fmtPnl(t.realized_pnl)}`
          );
        } else {
          // bot_trade_ref already existed (re-run idempotency)
          console.log(`  [SKIP-DUP] ${t.symbol.padEnd(6)} ${t.side.padEnd(6)} ref já existe no banco (idempotente)`);
        }
      } catch (err) {
        failed++;
        console.error(`  [FAILED]   ${t.symbol} ${t.side} opened=${fmtDate(t.opened_at)}: ${err.message}`);
      }
    }

    // Enrich trades missing exit_price
    for (const { match: db, historical: ht } of enrichCandidates) {
      try {
        const res = await client.query(
          `UPDATE trades
           SET exit_price   = $2,
               realized_pnl = COALESCE(realized_pnl, $3),
               closed_at    = COALESCE(closed_at, $4)
           WHERE id = $1 AND status = 'CLOSED' AND exit_price IS NULL`,
          [db.id, ht.exit_price, ht.realized_pnl ?? null, ht.closed_at ?? null]
        );
        if (res.rowCount > 0) {
          enriched++;
          console.log(
            `  [ENRICHED] id=${db.id}  ${db.symbol} ${db.side}  ` +
            `exit_price=${fmtPrice(ht.exit_price)}  pnl=${fmtPnl(ht.realized_pnl)}`
          );
        }
      } catch (err) {
        failed++;
        console.error(`  [ENRICH-FAIL] id=${db.id} ${db.symbol}: ${err.message}`);
      }
    }

    await client.query('COMMIT');
    console.log('');
    console.log(`  ✅ COMMIT OK — inserted=${inserted}  enriched=${enriched}  failed=${failed}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ❌ ROLLBACK — erro fatal: ${err.message}`);
    failed++;
  } finally {
    client.release();
  }

  console.log('');
  sep('═');
  console.log(`  [merge] Concluído. inserted=${inserted}  enriched=${enriched}  failed=${failed}`);
  sep('═');
  console.log('');
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// MODE: reset-rebuild
// ═════════════════════════════════════════════════════════════════════════════

if (MODE === 'reset-rebuild') {
  section('RESET-REBUILD — OPERAÇÃO DESTRUTIVA');
  console.log('');
  console.log('  ⚠️  ATENÇÃO: Esta operação irá:');
  console.log('     1. Apagar TODOS os trades venue=valiant mode=live do banco');
  console.log('     2. Apagar registros vinculados (trade_events, orders, balance_snapshots, signal_decisions)');
  console.log('     3. Reconstruir os trades históricos a partir dos fills consolidados da Hyperliquid');
  console.log('');
  console.log('  Tabelas NÃO afetadas:');
  console.log('    paper trades, telegram_notifications_sent, configurações, secrets');
  console.log('');

  const relCounts = await getRelatedCounts(pool);
  console.log('  Linhas que serão removidas:');
  console.log(`    trades             (venue=valiant, mode=live): ${dbCounts.live_valiant}`);
  console.log(`    trade_events       (vinculados):               ${relCounts.events}`);
  console.log(`    orders             (vinculados):               ${relCounts.orders}`);
  console.log(`    balance_snapshots  (vinculados):               ${relCounts.balance_snapshots}`);
  console.log(`    signal_decisions   (vinculados):               ${relCounts.signal_decisions}`);
  console.log('');
  console.log(`  Trades a reconstruir: ${cleanTrades.length}  (${ambiguousTrades.length} ambíguos serão ignorados)`);
  console.log('');

  // Logical backup to stdout before any destructive operation
  section('BACKUP LÓGICO — snapshot dos trades atuais');
  console.log('  (Salve o JSON abaixo se precisar restaurar manualmente)');
  console.log('');
  console.log('--- INÍCIO DO BACKUP ---');
  console.log(JSON.stringify(dbTrades, null, 2));
  console.log('--- FIM DO BACKUP ---');
  console.log('');

  let rebuilt = 0, failed = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Collect bot_trade_refs before deletion to clean related tables
    const refsRes = await client.query(
      `SELECT bot_trade_ref FROM trades
       WHERE venue = 'valiant' AND mode = 'live' AND bot_trade_ref IS NOT NULL`,
      []
    );
    const refs = refsRes.rows.map(r => r.bot_trade_ref).filter(Boolean);

    // Delete related records first (no FK cascade — must be done explicitly)
    if (refs.length > 0) {
      const ph = refs.map((_, i) => `$${i + 1}`).join(', ');
      await client.query(`DELETE FROM trade_events      WHERE bot_trade_ref IN (${ph})`, refs);
      await client.query(`DELETE FROM orders            WHERE bot_trade_ref IN (${ph})`, refs);
      await client.query(`DELETE FROM balance_snapshots WHERE bot_trade_ref IN (${ph})`, refs);
      await client.query(`DELETE FROM signal_decisions  WHERE bot_trade_ref IN (${ph})`, refs);
      console.log(`  🗑️  Deleted related records for ${refs.length} trade refs`);
    }

    // Delete trades
    const delRes = await client.query(
      `DELETE FROM trades WHERE venue = 'valiant' AND mode = 'live'`,
      []
    );
    console.log(`  🗑️  Deleted ${delRes.rowCount} row(s) from trades`);

    // Rebuild from consolidated historical trades
    for (const t of cleanTrades) {
      try {
        await client.query(
          // No ON CONFLICT here — table is clean after DELETE.
          // ::timestamptz casts ensure correct parsing of ISO strings regardless of session tz.
          `INSERT INTO trades (
             bot_trade_ref, symbol, side, status, mode, source, venue,
             entry_price, exit_price, size, leverage, realized_pnl,
             opened_at, closed_at
           ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::timestamptz,$14::timestamptz)`,
          tradeParams(t)
        );
        await insertTradeEvents(client, t);
        rebuilt++;
      } catch (err) {
        failed++;
        console.error(`  [REBUILD-FAIL] ${t.symbol} ${t.side} opened=${fmtDate(t.opened_at)}: ${err.message}`);
      }
    }

    await client.query('COMMIT');
    console.log(`  ✅ COMMIT OK — rebuilt=${rebuilt}  ignored_ambiguous=${ambiguousTrades.length}  failed=${failed}`);
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(`  ❌ ROLLBACK — erro fatal: ${err.message}`);
    failed++;
  } finally {
    client.release();
  }

  section('RELATÓRIO FINAL DE RECONSTRUÇÃO');
  const newCounts = await getDbValiantCounts(pool);
  console.log(`  Trades no banco após rebuild:`);
  console.log(`    Total:   ${newCounts.total_valiant}`);
  console.log(`    OPEN:    ${newCounts.open_valiant}`);
  console.log(`    CLOSED:  ${newCounts.closed_valiant}`);
  console.log(`    mode=live: ${newCounts.live_valiant}`);

  console.log('');
  sep('═');
  console.log(`  [reset-rebuild] Concluído. rebuilt=${rebuilt}  failed=${failed}`);
  sep('═');
  console.log('');
  await pool.end();
  process.exit(failed > 0 ? 1 : 0);
}

// ═════════════════════════════════════════════════════════════════════════════
// MODE: repair
// ═════════════════════════════════════════════════════════════════════════════
//
// Corrects opened_at / closed_at on trades previously imported by this script
// with wrong timestamps (e.g., DEFAULT now() was used instead of historical).
//
// Safety filter: only touches trades that have a TRADE_OPEN_PERSISTED event
// with payload.open_source = 'historical_backfill', ensuring live-adopted
// trades (source='system' from reconciliation) are never modified.
//
// A trade is flagged for repair when:
//   1. opened_at differs from the historical value by more than 1 hour, OR
//   2. opened_at is within 60 seconds of created_at (DEFAULT now() pattern).

if (MODE === 'repair') {
  section('REPAIR — Correção de timestamps históricos');
  console.log('  Escopo: somente trades com open_source=historical_backfill');
  console.log('  Critério: opened_at ≠ histórico (Δ > 1h) OU opened_at ≈ created_at (DEFAULT now())');
  console.log('');

  if (cleanTrades.length === 0) {
    console.log('  Nenhum trade histórico consolidado. Verifique --from/--to e VALIANT_ACCOUNT_ADDRESS.');
    await pool.end();
    process.exit(0);
  }

  // Build lookup map: bot_trade_ref → historical trade
  const historicalByRef = new Map(cleanTrades.map(t => [t.bot_trade_ref, t]));
  const repairRefs      = cleanTrades.map(t => t.bot_trade_ref);
  const phRepair        = repairRefs.map((_, i) => `$${i + 1}`).join(', ');

  let dbRepairTrades;
  try {
    const res = await pool.query(
      `SELECT t.id, t.bot_trade_ref, t.opened_at, t.closed_at, t.created_at, t.symbol, t.side
       FROM trades t
       WHERE t.bot_trade_ref IN (${phRepair})
         AND EXISTS (
           SELECT 1 FROM trade_events te
           WHERE te.bot_trade_ref = t.bot_trade_ref
             AND te.event_type    = 'TRADE_OPEN_PERSISTED'
             AND (te.payload->>'open_source') = 'historical_backfill'
         )`,
      repairRefs
    );
    dbRepairTrades = res.rows;
  } catch (err) {
    console.error(`  ❌ Erro ao buscar trades para repair: ${err.message}`);
    await pool.end();
    process.exit(1);
  }

  console.log(`  Trades históricos consolidados:   ${cleanTrades.length}`);
  console.log(`  Trades no banco com ref matching: ${dbRepairTrades.length}`);

  const ONE_HOUR_MS = 60 * 60 * 1000;
  const ONE_MIN_MS  = 60 * 1000;

  const toRepair = [];
  for (const db of dbRepairTrades) {
    const ht = historicalByRef.get(db.bot_trade_ref);
    if (!ht) continue;

    const dbOpenedAt  = db.opened_at  ? new Date(db.opened_at).getTime()  : null;
    const dbClosedAt  = db.closed_at  ? new Date(db.closed_at).getTime()  : null;
    const dbCreatedAt = db.created_at ? new Date(db.created_at).getTime() : null;
    const htOpenedAt  = ht.opened_at  ? new Date(ht.opened_at).getTime()  : null;
    const htClosedAt  = ht.closed_at  ? new Date(ht.closed_at).getTime()  : null;

    const openedAtWrong = htOpenedAt != null && (
      dbOpenedAt == null ||
      Math.abs(dbOpenedAt - htOpenedAt) > ONE_HOUR_MS ||
      (dbCreatedAt != null && Math.abs(dbOpenedAt - dbCreatedAt) < ONE_MIN_MS)
    );
    const closedAtWrong = htClosedAt != null && (
      dbClosedAt == null ||
      Math.abs(dbClosedAt - htClosedAt) > ONE_HOUR_MS ||
      (dbCreatedAt != null && Math.abs(dbClosedAt - dbCreatedAt) < ONE_MIN_MS)
    );

    if (openedAtWrong || closedAtWrong) {
      toRepair.push({ db, ht, openedAtWrong, closedAtWrong });
    }
  }

  console.log(`  Trades que precisam de repair:    ${toRepair.length}`);
  console.log('');

  if (toRepair.length === 0) {
    console.log('  ✅ Nenhum trade com timestamp incorreto detectado.');
    console.log('');
    sep('═');
    console.log('  [repair] Nenhuma alteração necessária.');
    sep('═');
    console.log('');
    await pool.end();
    process.exit(0);
  }

  console.log('  Preview das correções:');
  for (const { db, ht, openedAtWrong, closedAtWrong } of toRepair) {
    console.log(`    ${db.symbol.padEnd(6)} ${db.side.padEnd(6)} id=${db.id}`);
    if (openedAtWrong) console.log(`      opened_at: ${fmtDate(db.opened_at)} → ${fmtDate(ht.opened_at)}`);
    if (closedAtWrong) console.log(`      closed_at: ${fmtDate(db.closed_at)} → ${fmtDate(ht.closed_at)}`);
  }
  console.log('');

  let repaired = 0, repairFailed = 0;
  const repairClient = await pool.connect();
  try {
    await repairClient.query('BEGIN');

    for (const { db, ht, openedAtWrong, closedAtWrong } of toRepair) {
      try {
        const res = await repairClient.query(
          // Double-check safety filter inside the UPDATE to prevent race conditions
          `UPDATE trades
           SET opened_at = CASE WHEN $2 THEN $3::timestamptz ELSE opened_at END,
               closed_at = CASE WHEN $4 THEN $5::timestamptz ELSE closed_at END
           WHERE id = $1
             AND EXISTS (
               SELECT 1 FROM trade_events te
               WHERE te.bot_trade_ref = trades.bot_trade_ref
                 AND te.event_type    = 'TRADE_OPEN_PERSISTED'
                 AND (te.payload->>'open_source') = 'historical_backfill'
             )
           RETURNING id`,
          [
            db.id,
            openedAtWrong,
            ht.opened_at ?? null,
            closedAtWrong,
            ht.closed_at ?? null,
          ]
        );
        if (res.rowCount > 0) {
          repaired++;
          console.log(`  [REPAIRED] ${db.symbol.padEnd(6)} ${db.side.padEnd(6)} id=${db.id}`);
        }
      } catch (err) {
        repairFailed++;
        console.error(`  [REPAIR-FAIL] id=${db.id} ${db.symbol}: ${err.message}`);
      }
    }

    await repairClient.query('COMMIT');
    console.log('');
    console.log(`  ✅ COMMIT OK — repaired=${repaired}  failed=${repairFailed}`);
  } catch (err) {
    await repairClient.query('ROLLBACK');
    console.error(`  ❌ ROLLBACK — erro fatal: ${err.message}`);
    repairFailed++;
  } finally {
    repairClient.release();
  }

  console.log('');
  sep('═');
  console.log(`  [repair] Concluído. repaired=${repaired}  failed=${repairFailed}`);
  sep('═');
  console.log('');
  await pool.end();
  process.exit(repairFailed > 0 ? 1 : 0);
}

await pool.end();

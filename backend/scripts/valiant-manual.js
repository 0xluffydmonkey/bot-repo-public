#!/usr/bin/env node
// scripts/valiant-manual.js
//
// Manual execution script for controlled Valiant/Hyperliquid go-live testing.
// All operations are real — use only in a live account you control.
//
// Usage:
//   BOT_SECRETS_FILE=/opt/bot/secrets/bot-secrets.env node scripts/valiant-manual.js <cmd> [args]
//
// Commands:
//   positions                                — list all open positions
//   balance                                  — print account snapshot
//   open   <ASSET> <LONG|SHORT> <SIZE_BASE> <LEVERAGE> <LIMIT_PX>
//   close  <ASSET>                           — full close (reduce-only IOC)
//   reduce <ASSET> <SIZE_BASE>               — partial reduce (reduce-only IOC)
//
// Examples:
//   node scripts/valiant-manual.js positions
//   node scripts/valiant-manual.js balance
//   node scripts/valiant-manual.js open   SOL LONG  0.1 3 185.00
//   node scripts/valiant-manual.js close  SOL
//   node scripts/valiant-manual.js reduce SOL 0.05
//
// Notes:
//   - LIMIT_PX for open must include your own slippage (e.g. markPrice * 1.02 for LONG)
//   - close and reduce use current mid price plus the client slippage band
//   - The script fails hard on any API error — no silent failures

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname   = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

// Load secrets, then .env (secrets take precedence)
const secretsPath = process.env.BOT_SECRETS_FILE?.trim();
if (secretsPath) {
  dotenv.config({ path: secretsPath });
  console.log(`[MANUAL] Secrets loaded from: ${secretsPath}`);
}
dotenv.config({ path: path.join(backendRoot, '.env') });

// ── Import client after env is loaded ────────────────────────────────────────

const {
  getPositions,
  getAccountSnapshot,
  updateLeverage,
  placeOrder,
  closePosition,
  reducePosition,
} = await import('../src/trading/clients/hyperliquidClient.js');

const { VALIANT_MARKETS } = await import('../src/config/index.js');

// ── Helpers ───────────────────────────────────────────────────────────────────

function resolveAssetIndex(asset) {
  const idx = VALIANT_MARKETS.ASSET_INDEX[asset?.toUpperCase()];
  if (idx === undefined) {
    console.error(`[MANUAL] Unknown asset "${asset}". Supported: ${Object.keys(VALIANT_MARKETS.ASSET_INDEX).join(', ')}`);
    process.exit(1);
  }
  return idx;
}

function requireArgs(cmd, args, count, usage) {
  if (args.length < count) {
    console.error(`[MANUAL] "${cmd}" requires ${count} argument(s): ${usage}`);
    process.exit(1);
  }
}

function printPositions(positions) {
  if (positions.length === 0) {
    console.log('[MANUAL] No open positions.');
    return;
  }
  console.log(`[MANUAL] Open positions (${positions.length}):`);
  for (const p of positions) {
    const pos    = p.position;
    const szi    = parseFloat(pos.szi ?? '0');
    const side   = szi > 0 ? 'LONG' : 'SHORT';
    const size   = Math.abs(szi).toFixed(6);
    const entry  = parseFloat(pos.entryPx  ?? '0').toFixed(4);
    const pnl    = parseFloat(pos.unrealizedPnl ?? '0').toFixed(4);
    const lev    = pos.leverage?.value ?? '?';
    console.log(`  ${pos.coin.padEnd(12)} ${side.padEnd(6)} size=${size}  entry=$${entry}  uPnL=$${pnl}  lev=${lev}x`);
  }
}

// ── Subcommand dispatch ───────────────────────────────────────────────────────

const [,, cmd, ...args] = process.argv;

if (!cmd) {
  console.log('Usage: node scripts/valiant-manual.js <positions|balance|open|close|reduce> [args]');
  process.exit(0);
}

// ── positions ─────────────────────────────────────────────────────────────────

if (cmd === 'positions') {
  console.log('[MANUAL] Fetching open positions…');
  const positions = await getPositions();
  printPositions(positions);
  process.exit(0);
}

// ── balance ───────────────────────────────────────────────────────────────────

if (cmd === 'balance') {
  console.log('[MANUAL] Fetching account snapshot…');
  const snap = await getAccountSnapshot();
  console.log('[MANUAL] Account snapshot:');
  console.log(`  freeCollateral: $${snap.freeCollateral.toFixed(2)}`);
  console.log(`  totalEquity:    $${snap.totalEquity.toFixed(2)}`);
  console.log(`  positionCount:  ${snap.positionCount}`);
  console.log(`  totalNotional:  $${snap.totalNotional.toFixed(2)}`);
  process.exit(0);
}

// ── open ──────────────────────────────────────────────────────────────────────

if (cmd === 'open') {
  requireArgs(cmd, args, 5, '<ASSET> <LONG|SHORT> <SIZE_BASE> <LEVERAGE> <LIMIT_PX>');

  const [assetRaw, directionRaw, sizeRaw, levRaw, pxRaw] = args;
  const asset      = assetRaw.toUpperCase();
  const direction  = directionRaw.toUpperCase();
  const sizeBase   = parseFloat(sizeRaw);
  const leverage   = parseInt(levRaw, 10);
  const limitPx    = parseFloat(pxRaw).toFixed(6);
  const assetIndex = resolveAssetIndex(asset);

  if (direction !== 'LONG' && direction !== 'SHORT') {
    console.error(`[MANUAL] Direction must be LONG or SHORT, got "${directionRaw}"`);
    process.exit(1);
  }
  if (isNaN(sizeBase) || sizeBase <= 0) {
    console.error(`[MANUAL] Invalid SIZE_BASE: "${sizeRaw}"`);
    process.exit(1);
  }
  if (isNaN(leverage) || leverage <= 0) {
    console.error(`[MANUAL] Invalid LEVERAGE: "${levRaw}"`);
    process.exit(1);
  }
  if (isNaN(parseFloat(pxRaw)) || parseFloat(pxRaw) <= 0) {
    console.error(`[MANUAL] Invalid LIMIT_PX: "${pxRaw}"`);
    process.exit(1);
  }

  // Fail closed: warn if a position already exists for this asset
  const existing = await getPositions();
  const assetUpper = asset;
  const hasPosition = existing.some(
    (p) => p.position?.coin?.replace(/-PERP$/i, '').toUpperCase() === assetUpper
  );
  if (hasPosition) {
    console.error(`[MANUAL] Position already open for ${asset}. Close or reduce before opening a new one.`);
    process.exit(1);
  }

  const isBuy = direction === 'LONG';

  console.log(`[MANUAL] PRE-ORDER  venue=valiant asset=${asset} side=${direction} size=${sizeBase} leverage=${leverage}x limitPx=${limitPx} assetIndex=${assetIndex}`);

  console.log(`[MANUAL] Setting leverage: ${asset} → ${leverage}x`);
  const levResult = await updateLeverage(assetIndex, leverage, true);
  console.log('[MANUAL] Leverage result:', JSON.stringify(levResult));

  console.log(`[MANUAL] Placing order…`);
  const raw     = await placeOrder({ assetIndex, isBuy, size: sizeBase.toFixed(6), limitPrice: limitPx, reduceOnly: false });
  const status  = raw?.response?.data?.statuses?.[0];
  const orderId = String(status?.resting?.oid ?? status?.filled?.oid ?? 'unknown');

  console.log('[MANUAL] Raw response:', JSON.stringify(raw, null, 2));
  console.log(`[MANUAL] POST-ORDER  venue=valiant asset=${asset} side=${direction} orderId=${orderId}`);
  process.exit(0);
}

// ── close ─────────────────────────────────────────────────────────────────────

if (cmd === 'close') {
  requireArgs(cmd, args, 1, '<ASSET>');

  const asset      = args[0].toUpperCase();
  const assetIndex = resolveAssetIndex(asset);

  console.log(`[MANUAL] PRE-CLOSE  venue=valiant asset=${asset} assetIndex=${assetIndex}`);

  const { orderId, raw } = await closePosition(assetIndex, asset);

  console.log('[MANUAL] Raw response:', JSON.stringify(raw, null, 2));
  console.log(`[MANUAL] POST-CLOSE  venue=valiant asset=${asset} orderId=${orderId}`);
  process.exit(0);
}

// ── reduce ────────────────────────────────────────────────────────────────────

if (cmd === 'reduce') {
  requireArgs(cmd, args, 2, '<ASSET> <SIZE_BASE>');

  const asset      = args[0].toUpperCase();
  const sizeBase   = parseFloat(args[1]);
  const assetIndex = resolveAssetIndex(asset);

  if (isNaN(sizeBase) || sizeBase <= 0) {
    console.error(`[MANUAL] Invalid SIZE_BASE: "${args[1]}"`);
    process.exit(1);
  }

  console.log(`[MANUAL] PRE-REDUCE  venue=valiant asset=${asset} reduceSize=${sizeBase} assetIndex=${assetIndex}`);

  const { orderId, raw } = await reducePosition(assetIndex, asset, sizeBase);

  console.log('[MANUAL] Raw response:', JSON.stringify(raw, null, 2));
  console.log(`[MANUAL] POST-REDUCE  venue=valiant asset=${asset} orderId=${orderId} reduceSize=${sizeBase}`);
  process.exit(0);
}

// ── Unknown command ───────────────────────────────────────────────────────────

console.error(`[MANUAL] Unknown command "${cmd}". Use: positions | balance | open | close | reduce`);
process.exit(1);

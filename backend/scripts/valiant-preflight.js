#!/usr/bin/env node
// scripts/valiant-preflight.js
//
// Pre-flight validation for the FIRST real Valiant trade.
// Run this BEFORE switching PAPER_TRADING=false.
//
// Usage:
//   BOT_SECRETS_FILE=/opt/bot/secrets/bot-secrets.env node scripts/valiant-preflight.js
//
// What it does (read-only — no orders placed):
//   0. Check required env vars are set and not placeholders
//   1. GET /info?type=meta  → list markets, cross-check asset indices
//   2. GET /info?type=clearinghouseState → balance + open positions
//
// Exit codes:
//   0 = all checks passed, safe to proceed
//   1 = one or more checks failed, do NOT trade

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fetch from 'node-fetch';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(__dirname, '..');

// Load secrets file if specified
const secretsPath = process.env.BOT_SECRETS_FILE?.trim();
if (secretsPath) {
  dotenv.config({ path: secretsPath });
  console.log(`[PREFLIGHT] Secrets loaded from: ${secretsPath}`);
}
// Load .env
dotenv.config({ path: path.join(backendRoot, '.env') });

// ─── Expected asset indices (from config/index.js VALIANT_MARKETS.ASSET_INDEX)
const EXPECTED_ASSET_INDEX = {
  BTC:  0,
  ETH:  1,
  SOL:  5,
  AVAX: 6,
  BNB:  7,
  APT:  8,
  ARB:  9,
  DOGE: 10,
  SUI:  17,
  WIF:  21,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function ok(msg)   { console.log(`  ✓  ${msg}`); passed++; }
function fail(msg) { console.log(`  ✗  ${msg}`); failed++; }
function warn(msg) { console.log(`  ⚠  ${msg}`); }
function section(title) { console.log(`\n── ${title} ${'─'.repeat(50 - title.length)}`); }

async function postInfo(baseUrl, payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  try {
    const res = await fetch(`${baseUrl}/info`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(payload),
      signal:  controller.signal,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(data)}`);
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ─── Phase 0: Env vars ────────────────────────────────────────────────────────

section('Phase 0 — Environment Variables');

const baseUrl      = process.env.VALIANT_BASE_URL?.trim();
const agentKeyPath = process.env.VALIANT_AGENT_KEY_PATH?.trim();
const accountAddr  = process.env.VALIANT_ACCOUNT_ADDRESS?.trim();

function isPlaceholder(v) {
  return !v || v.startsWith('<') || v.startsWith('SET_IN') || v.startsWith('**') || v.includes('<') || v.includes('>');
}

if (isPlaceholder(baseUrl)) {
  fail(`VALIANT_BASE_URL not set or is a placeholder: "${baseUrl ?? '(empty)'}"`);
  fail('Cannot continue — set VALIANT_BASE_URL in .env first');
  process.exit(1);
} else {
  ok(`VALIANT_BASE_URL = ${baseUrl}`);
}

// The raw agent key must NEVER appear in env — only the path to the key file.
if (process.env.VALIANT_AGENT_KEY) {
  fail('VALIANT_AGENT_KEY detected in env — raw keys are not accepted. Use VALIANT_AGENT_KEY_PATH instead.');
} else if (isPlaceholder(agentKeyPath)) {
  fail(`VALIANT_AGENT_KEY_PATH not set — set to the path of the EVM key file (chmod 600)`);
} else {
  ok(`VALIANT_AGENT_KEY_PATH = ${agentKeyPath}`);
  // Verify the file is readable (does not log content)
  try {
    const { readFileSync } = await import('fs');
    const content = readFileSync(agentKeyPath, 'utf-8').trim();
    if (!content) {
      fail(`Key file is empty: ${agentKeyPath}`);
    } else {
      ok(`Key file readable: ${content.length} chars, prefix ${content.slice(0, 8)}…`);
    }
  } catch (err) {
    fail(`Cannot read key file "${agentKeyPath}": ${err.message}`);
  }
}

if (isPlaceholder(accountAddr)) {
  fail(`VALIANT_ACCOUNT_ADDRESS not set — add to BOT_SECRETS_FILE`);
} else {
  ok(`VALIANT_ACCOUNT_ADDRESS = ${accountAddr}`);
}

if (failed > 0) {
  console.log(`\n[PREFLIGHT] ✗ ${failed} env var(s) missing or misconfigured. Fix before continuing.\n`);
  process.exit(1);
}

// ─── Phase 1: fetchMeta — market list + asset index cross-check ───────────────

section('Phase 1 — fetchMeta() / Asset Index Cross-Check');

let meta;
try {
  meta = await postInfo(baseUrl, { type: 'meta' });
  ok(`/info?type=meta responded (${meta.universe?.length ?? 0} markets)`);
} catch (err) {
  fail(`fetchMeta failed: ${err.message}`);
  console.log(`\n[PREFLIGHT] ✗ Cannot reach ${baseUrl}/info. Check URL and network.\n`);
  process.exit(1);
}

const universe = meta.universe ?? [];
console.log('\n  Market list from API:');
universe.forEach((m, i) => {
  console.log(`    [${String(i).padStart(3)}] ${m.name}`);
});

console.log('\n  Cross-check vs VALIANT_MARKETS.ASSET_INDEX:');
let indexMismatch = false;
for (const [symbol, expectedIdx] of Object.entries(EXPECTED_ASSET_INDEX)) {
  const apiEntry = universe[expectedIdx];
  const apiName  = apiEntry?.name ?? '(not found)';
  // Normalize: API may return 'SOL', 'SOL-PERP', 'k-SOL' etc.
  const normalized = apiName.replace(/-PERP$/i, '').replace(/^k-/i, '').toUpperCase();
  if (normalized === symbol) {
    ok(`[${expectedIdx}] ${symbol} → API: "${apiName}" ✓`);
  } else {
    fail(`[${expectedIdx}] ${symbol} → API: "${apiName}" ✗  MISMATCH — update VALIANT_MARKETS.ASSET_INDEX`);
    indexMismatch = true;
  }
}

if (indexMismatch) {
  console.log('\n  [ACTION] Fix VALIANT_MARKETS.ASSET_INDEX in backend/src/config/index.js');
  console.log('  [ACTION] Use the market indices from the API list above');
  warn('Asset index mismatches detected — do NOT trade until fixed');
}

// ─── Phase 2: Account state (balance + positions) ─────────────────────────────

section('Phase 2 — getBalance() / getAccountSnapshot()');

let state;
try {
  state = await postInfo(baseUrl, { type: 'clearinghouseState', user: accountAddr });
  ok(`/info?type=clearinghouseState responded`);
} catch (err) {
  fail(`fetchAccountSnapshot failed: ${err.message}`);
  warn('If HTTP 401 or similar: check VALIANT_ACCOUNT_ADDRESS is a valid EVM address');
  process.exit(1);
}

const summary        = state.crossMarginSummary ?? {};
const accountValue   = parseFloat(summary.accountValue    ?? '0');
const marginUsed     = parseFloat(summary.totalMarginUsed ?? '0');
const freeCollateral = Math.max(0, accountValue - marginUsed);
const positions      = (state.assetPositions ?? []).filter(p => parseFloat(p.position?.szi ?? '0') !== 0);

console.log(`\n  Account summary:`);
console.log(`    accountValue:    $${accountValue.toFixed(2)}`);
console.log(`    totalMarginUsed: $${marginUsed.toFixed(2)}`);
console.log(`    freeCollateral:  $${freeCollateral.toFixed(2)}`);
console.log(`    openPositions:   ${positions.length}`);

if (accountValue === 0 && marginUsed === 0) {
  warn('All values are zero — account may not exist at this address, or API response shape is different');
  warn('Check: does the API return "crossMarginSummary" or a different field?');
  warn(`Raw response keys: ${Object.keys(state).join(', ')}`);
} else {
  ok('Account state looks valid');
}

if (freeCollateral < 10) {
  warn(`Low free collateral ($${freeCollateral.toFixed(2)}) — deposit before trading`);
} else {
  ok(`Free collateral sufficient for test trade: $${freeCollateral.toFixed(2)}`);
}

// ─── Phase 3: Auth readiness (EIP-712 — cannot be tested without an order) ────

section('Phase 3 — Auth Readiness (EIP-712 Phantom Agent)');

// /info is unauthenticated. Auth (EIP-712 body signing) is only exercised on
// the first POST /exchange. There is NO Authorization header — the signature
// is embedded in the request body as { action, nonce, signature: { r, s, v } }.
ok(`/info endpoint reachable (unauthenticated — signing tested on first order)`);
warn('Auth is EIP-712 "phantom agent" body signing — no Authorization header.');
warn('If the first order returns {"status":"err","response":"..."}, check:');
console.log('    → VALIANT_AGENT_KEY_PATH file contains a valid 0x-prefixed 32-byte hex key');
console.log('    → The derived agent address is authorized on Hyperliquid for VALIANT_ACCOUNT_ADDRESS');
console.log('    → VALIANT_CHAIN_ID matches the domain chainId (default: 1337 for Hyperliquid mainnet)');
console.log('    → client: hyperliquidClient.js _signAction()');

// ─── Summary ──────────────────────────────────────────────────────────────────

section('Summary');

if (failed > 0 || indexMismatch) {
  console.log(`\n[PREFLIGHT] ✗ NOT READY — ${failed} failure(s) found.\n`);
  console.log('  Fix the issues above before switching PAPER_TRADING=false.\n');
  process.exit(1);
} else {
  console.log(`\n[PREFLIGHT] ✓ All checks passed (${passed} checks, ${failed} failures).\n`);
  console.log('  Safe to proceed to first trade:');
  console.log('    1. Set PERP_OPEN_VENUE=valiant in .env');
  console.log('    2. Set PAPER_TRADING=false in .env');
  console.log('    3. Start bot and open a minimal manual position via Telegram');
  console.log('    4. Verify pre-order log → raw response → orderId in logs');
  console.log('    5. Close position and verify it disappears from open positions\n');
  process.exit(0);
}

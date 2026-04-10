// src/trading/clients/valiantClient.js
// Valiant REST API client — Hyperliquid-compatible format with header-based agent key auth.
//
// Valiant is a temporary live bridge (Hyperliquid-compatible API).
// Replace this client with the official Hyperliquid SDK when ready.
//
// ENVIRONMENT VARIABLES:
//   VALIANT_BASE_URL       — API base URL           (non-sensitive, safe in .env)
//   VALIANT_AGENT_KEY      — [SECRET] agent API key (BOT_SECRETS_FILE only, never .env)
//   VALIANT_ACCOUNT_ADDRESS— [SECRET] main account address, used for /info queries
//
// SECURITY:
//   - Agent key is read from env once, never logged
//   - Only the first 8 chars of the key are logged as a non-secret confirmation
//   - Fails fast with actionable error if secrets are missing

import fetch from 'node-fetch';
import logger from '../../utils/logger.js';

// ─── Config helpers ───────────────────────────────────────────────────────────

function getBaseUrl() {
  return (process.env.VALIANT_BASE_URL ?? 'https://api.hyperliquid.xyz').replace(/\/$/, '');
}

function getAccountAddress() {
  const addr = process.env.VALIANT_ACCOUNT_ADDRESS?.trim();
  if (!addr || addr === '' || addr.startsWith('SET_IN')) {
    throw new Error(
      '[VALIANT] VALIANT_ACCOUNT_ADDRESS nao definido.\n' +
      '  Adicione ao BOT_SECRETS_FILE:\n' +
      '  VALIANT_ACCOUNT_ADDRESS=0x<seu_endereco>'
    );
  }
  return addr;
}

// Agent key cached after first read (env read once per process)
let _agentKey = null;

function getAgentKey() {
  if (_agentKey) return _agentKey;

  const raw = process.env.VALIANT_AGENT_KEY?.trim();
  if (!raw || raw === '' || raw.startsWith('SET_IN')) {
    throw new Error(
      '[VALIANT] VALIANT_AGENT_KEY nao definido.\n' +
      '  Adicione ao BOT_SECRETS_FILE:\n' +
      '  VALIANT_AGENT_KEY=<sua_chave_de_agente>'
    );
  }

  _agentKey = raw;
  // Log only a non-secret prefix for confirmation — never the full key
  logger.info(`[VALIANT] Agent key carregada: ${raw.slice(0, 8)}…`);
  return _agentKey;
}

function buildHeaders() {
  return {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${getAgentKey()}`,
  };
}

// ─── HTTP layer ───────────────────────────────────────────────────────────────

/**
 * POST to /exchange — authenticated, signed with agent key via header.
 *
 * Body format: { action, nonce }
 * Auth: Authorization: Bearer <VALIANT_AGENT_KEY>
 *
 * Throws immediately on any API error — does NOT swallow errors.
 *
 * @param {object} action
 * @returns {Promise<object>}
 */
async function _postExchange(action) {
  const nonce = Date.now();
  const body  = JSON.stringify({ action, nonce });
  const url   = `${getBaseUrl()}/exchange`;

  logger.debug('[VALIANT] POST /exchange →', { action, nonce });

  const res = await fetch(url, {
    method:  'POST',
    headers: buildHeaders(),
    body,
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      `[VALIANT] /exchange retornou resposta invalida (status ${res.status}). ` +
      'Verifique VALIANT_BASE_URL e conectividade.'
    );
  }

  logger.debug('[VALIANT] POST /exchange ←', { status: res.status, data });

  if (!res.ok || data?.status === 'err') {
    const detail = data?.response ?? data?.error ?? JSON.stringify(data);
    throw new Error(`[VALIANT] Exchange error (HTTP ${res.status}): ${detail}`);
  }

  return data;
}

/**
 * POST to /info — unauthenticated query endpoint.
 *
 * @param {object} payload
 * @returns {Promise<object>}
 */
async function _postInfo(payload) {
  const url = `${getBaseUrl()}/info`;

  logger.debug('[VALIANT] POST /info →', payload);

  const res = await fetch(url, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(payload),
  });

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      `[VALIANT] /info retornou resposta invalida (status ${res.status}). ` +
      'Verifique VALIANT_BASE_URL e conectividade.'
    );
  }

  logger.debug('[VALIANT] POST /info ←', { status: res.status, data });

  if (!res.ok) {
    throw new Error(`[VALIANT] Info error (HTTP ${res.status}): ${url}`);
  }

  return data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sets cross leverage for an asset.
 * Must be called before placing an order to ensure correct leverage is applied.
 *
 * @param {number}  assetIndex
 * @param {number}  leverage
 * @param {boolean} [isCross=true]
 * @returns {Promise<object>}
 */
export async function updateLeverage(assetIndex, leverage, isCross = true) {
  return _postExchange({
    type:     'updateLeverage',
    asset:    assetIndex,
    isCross,
    leverage,
  });
}

/**
 * Places an Immediate-Or-Cancel limit order (market-equivalent).
 *
 * Price guidance:
 *   LONG open:  limitPrice = entry * (1 + slippage)  → fills if market ≤ price
 *   SHORT open: limitPrice = entry * (1 - slippage)  → fills if market ≥ price
 *   Close LONG: limitPrice = '1'                     → always fills (reduce-only)
 *   Close SHORT:limitPrice = '999999999'              → always fills (reduce-only)
 *
 * @param {object}  params
 * @param {number}  params.assetIndex
 * @param {boolean} params.isBuy
 * @param {string}  params.size        - base quantity as string (e.g. '1.500000')
 * @param {string}  params.limitPrice  - price as string
 * @param {boolean} [params.reduceOnly=false]
 * @returns {Promise<object>}
 */
export async function placeOrder({ assetIndex, isBuy, size, limitPrice, reduceOnly = false }) {
  return _postExchange({
    type:     'order',
    orders: [
      {
        a: assetIndex,
        b: isBuy,
        p: limitPrice,
        s: size,
        r: reduceOnly,
        t: { limit: { tif: 'Ioc' } },
      },
    ],
    grouping: 'na',
  });
}

/**
 * Fetches full clearinghouse state for the configured account.
 * Raw Valiant/Hyperliquid response — use fetchAccountSnapshot() for the venue-agnostic shape.
 *
 * @returns {Promise<object>}
 */
export async function fetchClearinghouseState() {
  return _postInfo({ type: 'clearinghouseState', user: getAccountAddress() });
}

/**
 * Returns non-zero asset positions (raw API objects).
 * @returns {Promise<Array>}
 */
export async function fetchOpenPositions() {
  const state = await fetchClearinghouseState();
  return (state.assetPositions ?? []).filter(
    (p) => parseFloat(p.position?.szi ?? '0') !== 0
  );
}

/**
 * Returns account snapshot in the venue-agnostic shape.
 * @returns {Promise<{ freeCollateral: number, totalEquity: number, positionCount: number, totalNotional: number }>}
 */
export async function fetchAccountSnapshot() {
  const state         = await fetchClearinghouseState();
  const marginSummary = state.crossMarginSummary ?? {};
  const positions     = state.assetPositions ?? [];

  const accountValue    = parseFloat(marginSummary.accountValue    ?? '0');
  const totalMarginUsed = parseFloat(marginSummary.totalMarginUsed ?? '0');
  const freeCollateral  = Math.max(0, accountValue - totalMarginUsed);

  const openPositions = positions.filter(
    (p) => parseFloat(p.position?.szi ?? '0') !== 0
  );

  const totalNotional = openPositions.reduce((acc, p) => {
    return acc + Math.abs(parseFloat(p.position?.positionValue ?? '0'));
  }, 0);

  return {
    freeCollateral,
    totalEquity:   accountValue,
    positionCount: openPositions.length,
    totalNotional,
  };
}

/**
 * Returns free collateral as a plain USD number.
 * @returns {Promise<number>}
 */
export async function getBalance() {
  const snap = await fetchAccountSnapshot();
  return snap.freeCollateral;
}

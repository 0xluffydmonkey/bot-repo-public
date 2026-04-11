// src/trading/clients/hyperliquidClient.js
//
// Hyperliquid perp execution client.
// Used by the Valiant adapter — Valiant routes perp execution through Hyperliquid.
//
// Auth protocol: EIP-712 "phantom agent" signing.
//   The agent wallet signs each action before it is sent.
//   Auth is carried in the request BODY (action + nonce + signature).
//   There is NO Authorization header on /exchange.
//
// ENVIRONMENT VARIABLES:
//   Non-sensitive (safe in .env):
//     VALIANT_BASE_URL        — Hyperliquid API base URL
//     VALIANT_CHAIN_ID        — EIP-712 domain chainId (default: 1337)
//   Path-only (safe in .env or BOT_SECRETS_FILE):
//     VALIANT_AGENT_KEY_PATH  — path to file containing the agent EVM private key
//     VALIANT_ACCOUNT_ADDRESS — main account EVM address (not a key; public info)
//
// SECURITY:
//   - Raw private key is NEVER in an env var — loaded from file via secretFileLoader
//   - Only the derived public wallet address is logged on first load
//   - Fails fast with clear errors if path var unset, file missing, or key malformed

import fetch, { AbortError } from 'node-fetch';
import { ethers }            from 'ethers';
import { encode as msgpackEncode } from '@msgpack/msgpack';
import logger from '../../utils/logger.js';
import { loadSecretFromFile } from '../../services/secretFileLoader.js';

const REQUEST_TIMEOUT_MS = 10_000;

// ─── Config ───────────────────────────────────────────────────────────────────

function getBaseUrl() {
  return (process.env.VALIANT_BASE_URL ?? 'https://api.hyperliquid.xyz').replace(/\/$/, '');
}

function getChainId() {
  // Hyperliquid mainnet uses chainId 1337 for EIP-712 domain.
  return parseInt(process.env.VALIANT_CHAIN_ID ?? '1337', 10);
}

function getAccountAddress() {
  const addr = process.env.VALIANT_ACCOUNT_ADDRESS?.trim();
  if (!addr || addr.startsWith('SET_IN') || addr.startsWith('<')) {
    throw new Error(
      '[HL] VALIANT_ACCOUNT_ADDRESS nao definido.\n' +
      '  Adicione ao BOT_SECRETS_FILE:\n' +
      '  VALIANT_ACCOUNT_ADDRESS=0x<seu_endereco_evm>'
    );
  }
  return addr;
}

// Agent wallet — loaded once, from the file pointed to by VALIANT_AGENT_KEY_PATH.
// The raw private key is NEVER stored in an env var.
let _agentWallet = null;

function getAgentWallet() {
  if (_agentWallet) return _agentWallet;

  const raw = loadSecretFromFile(
    'VALIANT_AGENT_KEY_PATH',
    'Valiant/Hyperliquid agent private key'
  );

  const key = raw.startsWith('0x') ? raw : `0x${raw}`;
  try {
    _agentWallet = new ethers.Wallet(key);
  } catch {
    throw new Error(
      '[HL] Conteudo de VALIANT_AGENT_KEY_PATH invalido.\n' +
      '  O arquivo deve conter um private key EVM hex de 32 bytes (64 hex chars).\n' +
      '  Exemplo: 0xabc123...def'
    );
  }

  // Log only the derived public address — never the raw key
  logger.info(`[HL] Agent wallet carregada: ${_agentWallet.address}`);
  return _agentWallet;
}

// ─── EIP-712 signing (Hyperliquid "phantom agent" protocol) ───────────────────
//
// Hyperliquid uses a custom signing scheme sometimes called "phantom agent":
//
//   1. hash  = keccak256( msgpack(action) || nonce_as_uint64_be || vault_byte )
//   2. domain = { name:'Exchange', version:'1', chainId:1337, verifyingContract:'0x0…0' }
//   3. types  = { Agent: [{ name:'source', type:'string' }, { name:'connectionId', type:'bytes32' }] }
//   4. value  = { source: 'a', connectionId: hash }
//   5. sig    = agentWallet.signTypedData(domain, types, value)
//   6. body   = { action, nonce, signature: { r, s, v } }
//
// Reference: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing

function _buildConnectionId(action, nonce, vaultAddress = null) {
  const packed   = msgpackEncode(action);
  const nonceBuf = Buffer.allocUnsafe(8);
  nonceBuf.writeBigUInt64BE(BigInt(nonce));

  const vaultBuf = vaultAddress
    ? Buffer.concat([Buffer.from([1]), Buffer.from(vaultAddress.replace(/^0x/, ''), 'hex')])
    : Buffer.from([0]);

  return ethers.keccak256(Buffer.concat([Buffer.from(packed), nonceBuf, vaultBuf]));
}

async function _signAction(action, nonce, vaultAddress = null) {
  const wallet       = getAgentWallet();
  const connectionId = _buildConnectionId(action, nonce, vaultAddress);

  const domain = {
    name:              'Exchange',
    version:           '1',
    chainId:           getChainId(),
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  const types = {
    Agent: [
      { name: 'source',       type: 'string'  },
      { name: 'connectionId', type: 'bytes32' },
    ],
  };
  const value = {
    source:       vaultAddress ? 'b' : 'a',
    connectionId,
  };

  const sig        = await wallet.signTypedData(domain, types, value);
  const { r, s, v } = ethers.Signature.from(sig);
  return { r, s, v };
}

// ─── HTTP layer ───────────────────────────────────────────────────────────────

async function _post(url, body, headers = { 'Content-Type': 'application/json' }) {
  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers,
      body:   JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    if (err instanceof AbortError) {
      throw new Error(`[HL] Timeout apos ${REQUEST_TIMEOUT_MS}ms: ${url}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }

  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(`[HL] Resposta invalida (HTTP ${res.status}): ${url}`);
  }

  return { status: res.status, ok: res.ok, data };
}

/**
 * POST to /exchange — signs the action with EIP-712 before sending.
 * Auth is entirely in the body signature — no Authorization header.
 */
async function _postExchange(action) {
  const nonce     = Date.now();
  const signature = await _signAction(action, nonce);
  const url       = `${getBaseUrl()}/exchange`;

  logger.debug('[HL] POST /exchange →', { action, nonce });

  const { status, ok, data } = await _post(url, { action, nonce, signature });

  logger.debug('[HL] POST /exchange ←', { status, data });

  if (!ok || data?.status === 'err') {
    const detail = data?.response ?? data?.error ?? JSON.stringify(data);
    // Hint at EIP-712 signing misconfiguration when the error looks auth-related.
    const authHint = typeof detail === 'string' && /invalid|agent|auth|sign|unauthorized/i.test(detail)
      ? '\n  → Possible EIP-712 signing error. Verify VALIANT_AGENT_KEY_PATH content and that the agent address is authorized on Hyperliquid for VALIANT_ACCOUNT_ADDRESS.'
      : '';
    throw new Error(`[HL] Exchange error (HTTP ${status}): ${detail}${authHint}`);
  }

  // Hyperliquid returns HTTP 200 even for order-level rejections.
  // Check statuses[0].error before treating the call as successful.
  const statuses = data?.response?.data?.statuses;
  if (Array.isArray(statuses)) {
    const rejected = statuses.find((s) => s.error != null);
    if (rejected) {
      throw new Error(`[HL] Order rejected: ${rejected.error}`);
    }
  }

  return data;
}

/**
 * POST to /info — unauthenticated, no signing required.
 */
async function _postInfo(payload) {
  const url = `${getBaseUrl()}/info`;

  logger.debug('[HL] POST /info →', payload);

  const { status, ok, data } = await _post(url, payload);

  logger.debug('[HL] POST /info ←', { status, data });

  if (!ok) {
    throw new Error(`[HL] Info error (HTTP ${status}): ${url}`);
  }

  return data;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Set cross leverage for an asset before placing an order.
 *
 * @param {number}  assetIndex
 * @param {number}  leverage
 * @param {boolean} [isCross=true]
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
 * Place an IOC limit order (market-equivalent).
 *
 * Price guidance:
 *   Open LONG:   limitPrice = markPrice * 1.02  (fill immediately if market ≤ price)
 *   Open SHORT:  limitPrice = markPrice * 0.98
 *   Close LONG:  limitPrice = '1'               (reduce-only, always fills)
 *   Close SHORT: limitPrice = '999999999'
 *
 * @param {{ assetIndex: number, isBuy: boolean, size: string, limitPrice: string, reduceOnly?: boolean }}
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
 * Close the open position for a given asset.
 *
 * Fetches the current position from the API, then places a full-size
 * reduce-only IOC order on the opposite side.
 *
 * @param {number} assetIndex
 * @param {string} coinName   - used only for matching in position list (e.g. 'SOL')
 * @returns {Promise<{ orderId: string, raw: object }>}
 */
export async function closePosition(assetIndex, coinName) {
  const positions = await getPositions();
  const coinUpper = coinName.toUpperCase();

  const pos = positions.find(
    (p) => p.position?.coin?.replace(/-PERP$/i, '').toUpperCase() === coinUpper
  );

  if (!pos) {
    throw new Error(`[HL] Sem posicao aberta em "${coinName}" para fechar`);
  }

  const szi     = parseFloat(pos.position.szi);
  const isLong  = szi > 0;
  const absSize = Math.abs(szi).toFixed(6);
  const isBuy   = !isLong;
  const closePx = isLong ? '1' : '999999999';

  logger.info('[HL] closePosition', { coinName, side: isLong ? 'LONG' : 'SHORT', size: absSize, assetIndex });

  const raw     = await placeOrder({ assetIndex, isBuy, size: absSize, limitPrice: closePx, reduceOnly: true });
  const status  = raw?.response?.data?.statuses?.[0];
  const orderId = String(status?.resting?.oid ?? status?.filled?.oid ?? 'unknown');

  return { orderId, raw };
}

/**
 * Reduce an open position by a specific base-asset size (reduce-only IOC).
 * Fails if no open position exists or the requested size exceeds the open size.
 *
 * @param {number} assetIndex
 * @param {string} coinName   - used to match position (e.g. 'SOL')
 * @param {number} sizeBase   - base-asset units to reduce (must be ≤ open size)
 * @returns {Promise<{ orderId: string, raw: object }>}
 */
export async function reducePosition(assetIndex, coinName, sizeBase) {
  const positions = await getPositions();
  const coinUpper = coinName.toUpperCase();

  const pos = positions.find(
    (p) => p.position?.coin?.replace(/-PERP$/i, '').toUpperCase() === coinUpper
  );

  if (!pos) {
    throw new Error(`[HL] Sem posicao aberta em "${coinName}" para reduzir`);
  }

  const szi      = parseFloat(pos.position.szi);
  const isLong   = szi > 0;
  const openSize = Math.abs(szi);

  if (sizeBase > openSize) {
    throw new Error(
      `[HL] Tamanho de reducao (${sizeBase}) excede posicao aberta (${openSize.toFixed(6)}) em "${coinName}"`
    );
  }

  const isBuy   = !isLong;
  const closePx = isLong ? '1' : '999999999';
  const size    = sizeBase.toFixed(6);

  logger.info('[HL] reducePosition', {
    coinName,
    side:       isLong ? 'LONG' : 'SHORT',
    reduceSize: size,
    openSize:   openSize.toFixed(6),
    assetIndex,
  });

  const raw     = await placeOrder({ assetIndex, isBuy, size, limitPrice: closePx, reduceOnly: true });
  const status  = raw?.response?.data?.statuses?.[0];
  const orderId = String(status?.resting?.oid ?? status?.filled?.oid ?? 'unknown');

  return { orderId, raw };
}

/**
 * Returns all non-zero asset positions (raw Hyperliquid objects).
 * @returns {Promise<Array>}
 */
export async function getPositions() {
  const state = await _postInfo({ type: 'clearinghouseState', user: getAccountAddress() });
  return (state.assetPositions ?? []).filter(
    (p) => parseFloat(p.position?.szi ?? '0') !== 0
  );
}

/**
 * Returns free collateral as a plain USD number.
 * @returns {Promise<number>}
 */
export async function getBalance() {
  const snap = await getAccountSnapshot();
  return snap.freeCollateral;
}

/**
 * Returns account snapshot in the venue-agnostic shape used by the risk manager.
 * @returns {Promise<{ freeCollateral: number, totalEquity: number, positionCount: number, totalNotional: number }>}
 */
export async function getAccountSnapshot() {
  const state         = await _postInfo({ type: 'clearinghouseState', user: getAccountAddress() });
  const marginSummary = state.crossMarginSummary ?? {};
  const positions     = state.assetPositions     ?? [];

  const accountValue    = parseFloat(marginSummary.accountValue    ?? '0');
  const totalMarginUsed = parseFloat(marginSummary.totalMarginUsed ?? '0');
  const freeCollateral  = Math.max(0, accountValue - totalMarginUsed);

  const open = positions.filter((p) => parseFloat(p.position?.szi ?? '0') !== 0);
  const totalNotional = open.reduce(
    (acc, p) => acc + Math.abs(parseFloat(p.position?.positionValue ?? '0')),
    0
  );
  const unrealizedPnl = open.reduce(
    (acc, p) => acc + parseFloat(p.position?.unrealizedPnl ?? '0'),
    0
  );

  return {
    freeCollateral,
    totalEquity:   accountValue,
    positionCount: open.length,
    totalNotional,
    marginUsed:    totalMarginUsed,
    unrealizedPnl,
  };
}

/**
 * Returns all open orders for the account (all assets).
 * Used by setTpSl to cancel existing TP/SL before placing new ones.
 * @returns {Promise<Array>}
 */
export async function getOpenOrders() {
  const data = await _postInfo({ type: 'openOrders', user: getAccountAddress() });
  return Array.isArray(data) ? data : [];
}

/**
 * Cancel all open orders for a specific asset (best-effort, never throws).
 * Used internally by setTpSl to clear existing TP/SL before placing new ones.
 * Logs a warning on failure but does not re-throw — cancel failure must not
 * block subsequent TP/SL placement.
 */
async function _cancelOrdersForAsset(assetIndex, coinName) {
  let orders;
  try {
    orders = await getOpenOrders();
  } catch (err) {
    logger.warn(`[HL] getOpenOrders failed during cancel for ${coinName}: ${err.message} — skipping cancel`);
    return 0;
  }

  const coinUpper = coinName.toUpperCase();
  const toCancel  = orders.filter(
    (o) => o.coin?.replace(/-PERP$/i, '').toUpperCase() === coinUpper
  );

  if (toCancel.length === 0) return 0;

  const cancels = toCancel.map((o) => ({ a: assetIndex, o: o.oid }));
  try {
    await _postExchange({ type: 'cancel', cancels });
    logger.info(`[HL] Cancelled ${toCancel.length} existing order(s) for ${coinName}`);
  } catch (err) {
    logger.warn(`[HL] Cancel orders failed for ${coinName}: ${err.message} — continuing to TP/SL placement`);
  }
  return toCancel.length;
}

/**
 * Place or replace TP/SL trigger orders for an open position.
 *
 * Flow:
 *   1. Fetch current position (size + direction)
 *   2. Cancel all existing orders for the asset (best-effort)
 *   3. Place TP trigger order  (if tp != null)
 *   4. Place SL trigger order  (if sl != null)
 *
 * Uses native Hyperliquid trigger orders (isMarket:true, reduce-only).
 * When triggered, orders execute as market orders at exchange level —
 * no bot process needed for execution after placement.
 *
 * @param {number}      assetIndex
 * @param {string}      coinName   - e.g. 'SOL', 'BTC'
 * @param {number|null} tp         - take profit price (null = skip)
 * @param {number|null} sl         - stop loss price (null = skip)
 * @returns {Promise<Array<{ type: 'tp'|'sl', price: number, orderId: string }>>}
 */
export async function setTpSl(assetIndex, coinName, tp, sl) {
  if (tp == null && sl == null) return [];

  // Fetch position to determine size and direction for the close orders
  const positions = await getPositions();
  const coinUpper = coinName.toUpperCase();
  const pos = positions.find(
    (p) => p.position?.coin?.replace(/-PERP$/i, '').toUpperCase() === coinUpper
  );

  if (!pos) {
    throw new Error(`[HL] setTpSl: sem posicao aberta em "${coinName}"`);
  }

  const szi    = parseFloat(pos.position.szi);
  const isLong = szi > 0;
  const size   = Math.abs(szi).toFixed(6);
  // Close direction is opposite to open direction
  const closeBuy = !isLong; // true = buy to close SHORT; false = sell to close LONG
  // Far-side limit prices match the IOC close pattern (always fill when triggered)
  const limitPx  = closeBuy ? '999999999' : '1';

  logger.info('[HL] setTpSl', {
    coinName,
    side:      isLong ? 'LONG' : 'SHORT',
    size,
    tp:        tp  ?? '(skip)',
    sl:        sl  ?? '(skip)',
    assetIndex,
  });

  // Cancel any existing orders for this asset before placing new ones
  await _cancelOrdersForAsset(assetIndex, coinName);

  const placed = [];

  if (tp != null) {
    const tpResult = await _postExchange({
      type:     'order',
      orders: [{
        a: assetIndex,
        b: closeBuy,
        p: limitPx,
        s: size,
        r: true, // reduce-only
        t: { trigger: { triggerPx: String(tp), isMarket: true, tpsl: 'tp' } },
      }],
      grouping: 'na',
    });
    const tpSt    = tpResult?.response?.data?.statuses?.[0];
    const tpOid   = String(tpSt?.resting?.oid ?? tpSt?.filled?.oid ?? 'unknown');
    logger.info('[HL] TP order placed', { coinName, tp, orderId: tpOid });
    placed.push({ type: 'tp', price: tp, orderId: tpOid });
  }

  if (sl != null) {
    const slResult = await _postExchange({
      type:     'order',
      orders: [{
        a: assetIndex,
        b: closeBuy,
        p: limitPx,
        s: size,
        r: true,
        t: { trigger: { triggerPx: String(sl), isMarket: true, tpsl: 'sl' } },
      }],
      grouping: 'na',
    });
    const slSt    = slResult?.response?.data?.statuses?.[0];
    const slOid   = String(slSt?.resting?.oid ?? slSt?.filled?.oid ?? 'unknown');
    logger.info('[HL] SL order placed', { coinName, sl, orderId: slOid });
    placed.push({ type: 'sl', price: sl, orderId: slOid });
  }

  return placed;
}

/**
 * Fetch exchange metadata (market universe).
 * Use this to verify asset indices before trading:
 *   meta.universe.forEach((m, i) => console.log(i, m.name))
 */
export async function fetchMeta() {
  return _postInfo({ type: 'meta' });
}

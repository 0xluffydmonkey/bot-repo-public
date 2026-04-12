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
const MAX_WIRE_DECIMALS = 8;
const MAX_PERP_PRICE_DECIMALS = 6;
const MAX_PRICE_SIG_FIGS = 5;
const MARKET_CLOSE_SLIPPAGE_PCT = 0.05;
const TRIGGER_MARKET_SLIPPAGE_PCT = 0.10;

// ─── Config ───────────────────────────────────────────────────────────────────

function getBaseUrl() {
  return (process.env.VALIANT_BASE_URL ?? 'https://api.hyperliquid.xyz').replace(/\/$/, '');
}

function getChainId() {
  // Hyperliquid mainnet uses chainId 1337 for EIP-712 domain.
  return parseInt(process.env.VALIANT_CHAIN_ID ?? '1337', 10);
}

function getHyperliquidChain() {
  return process.env.VALIANT_HYPERLIQUID_CHAIN?.trim() || 'Mainnet';
}

function getSignatureChainId() {
  // Human-readable transfer actions use the signer chain id, e.g. Arbitrum mainnet.
  return process.env.VALIANT_SIGNATURE_CHAIN_ID?.trim() || '0xa4b1';
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

function _decimalToWire(value, fieldName) {
  const raw = String(value ?? '').trim();
  if (!raw) {
    throw new Error(`[HL] ${fieldName} vazio`);
  }

  if (!/^-?(?:\d+|\d*\.\d+)$/.test(raw)) {
    throw new Error(`[HL] ${fieldName} invalido para Hyperliquid wire format: "${raw}"`);
  }

  const negative = raw.startsWith('-');
  const unsigned = negative ? raw.slice(1) : raw;
  const [wholePart, fractionPart = ''] = unsigned.split('.');
  const whole = wholePart.replace(/^0+(?=\d)/, '') || '0';
  const fraction = fractionPart.replace(/0+$/, '');

  if (fraction.length > MAX_WIRE_DECIMALS) {
    throw new Error(
      `[HL] ${fieldName} tem mais de ${MAX_WIRE_DECIMALS} casas decimais: "${raw}"`
    );
  }

  const normalized = fraction ? `${whole}.${fraction}` : whole;
  if (normalized === '0') return '0';
  return negative ? `-${normalized}` : normalized;
}

function _priceToWire(value, fieldName = 'price') {
  const px = Number(value);
  if (!Number.isFinite(px) || px <= 0) {
    throw new Error(`[HL] ${fieldName} invalido: ${value}`);
  }

  // Hyperliquid order prices are constrained by significant figures. This
  // mirrors the official SDK pattern: round to 5 significant figures, then
  // cap perp prices at 6 decimal places before msgpack signing.
  const rounded = Number(px.toPrecision(MAX_PRICE_SIG_FIGS));
  return _decimalToWire(rounded.toFixed(MAX_PERP_PRICE_DECIMALS), fieldName);
}

function _aggressiveLimitPrice(referencePrice, isBuy, slippagePct = MARKET_CLOSE_SLIPPAGE_PCT) {
  const px = Number(referencePrice);
  if (!Number.isFinite(px) || px <= 0) {
    throw new Error(`[HL] preco de referencia invalido: ${referencePrice}`);
  }

  const adjusted = px * (isBuy ? 1 + slippagePct : 1 - slippagePct);
  return _priceToWire(adjusted, 'limitPrice');
}

function _triggerMarketLimitPrice(triggerPrice, isBuy) {
  return _aggressiveLimitPrice(triggerPrice, isBuy, TRIGGER_MARKET_SLIPPAGE_PCT);
}

async function _getMidPrice(coinName) {
  const coinUpper = coinName.toUpperCase();
  const mids = await _postInfo({ type: 'allMids' });
  const raw = mids?.[coinUpper] ?? mids?.[`${coinUpper}-PERP`];
  const px = parseFloat(raw);
  if (!Number.isFinite(px) || px <= 0) {
    throw new Error(`[HL] allMids sem preco valido para "${coinName}"`);
  }
  return px;
}

function _positionMarkPrice(pos) {
  const size = Math.abs(parseFloat(pos?.position?.szi ?? '0'));
  const value = Math.abs(parseFloat(pos?.position?.positionValue ?? '0'));
  if (!Number.isFinite(size) || !Number.isFinite(value) || size <= 0 || value <= 0) {
    return null;
  }
  return value / size;
}

// Agent wallet — loaded once, from the file pointed to by VALIANT_AGENT_KEY_PATH.
// Used for orders, cancels, leverage updates (phantom-agent scheme).
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

// Main account wallet — loaded once, from VALIANT_MAIN_KEY_PATH when set.
// Required for user-signed actions (usdClassTransfer) which Hyperliquid validates
// by recovering the signer address directly from the EIP-712 signature.
// Agent wallets CANNOT sign transfers — Hyperliquid docs: "API wallets cannot
// initiate withdrawals, transfers, or approval operations."
//
// Identity model:
//   VALIANT_AGENT_KEY_PATH   → signer for orders (phantom-agent scheme)
//   VALIANT_MAIN_KEY_PATH    → signer for transfers (user-signed scheme)
//   VALIANT_ACCOUNT_ADDRESS  → query target only; never used as a signing identity
//
// VALIANT_MAIN_KEY_PATH:
//   If set  → load that key and use it for transfers.
//   If unset AND agent address == VALIANT_ACCOUNT_ADDRESS → use agent key (single-key setup).
//   If unset AND agent address ≠ VALIANT_ACCOUNT_ADDRESS → THROW immediately (fail closed).
//     Rationale: the transfer would fail at the API anyway ("Must deposit before performing
//     actions. User: <agent-address>"). Throwing here gives a precise local error instead
//     of a late HTTP 200 rejection with no actionable detail.
let _mainAccountWallet = null;

function getMainAccountWallet() {
  if (_mainAccountWallet) return _mainAccountWallet;

  const mainKeyPath    = process.env.VALIANT_MAIN_KEY_PATH?.trim();
  const hasExplicitKey = mainKeyPath && !mainKeyPath.startsWith('<') && !mainKeyPath.startsWith('SET_IN');
  const configuredAcct = (process.env.VALIANT_ACCOUNT_ADDRESS ?? '').trim();

  let wallet;

  if (hasExplicitKey) {
    const raw = loadSecretFromFile(
      'VALIANT_MAIN_KEY_PATH',
      'Valiant main account private key (for transfers)'
    );
    const key = raw.startsWith('0x') ? raw : `0x${raw}`;
    try {
      wallet = new ethers.Wallet(key);
    } catch {
      throw new Error(
        '[HL] Conteudo de VALIANT_MAIN_KEY_PATH invalido.\n' +
        '  O arquivo deve conter a private key EVM da conta principal (32 bytes hex).'
      );
    }
    logger.info(`[HL] Main account wallet carregada de VALIANT_MAIN_KEY_PATH: ${wallet.address}`);
  } else {
    // No explicit main key — fall back to the agent wallet.
    // This is only safe when the agent wallet IS the main account (single-key setup).
    // If they differ, throw now: the transfer will fail at the Hyperliquid API with a
    // misleading "Must deposit" error; a local throw here is far more actionable.
    const agentWallet = getAgentWallet();

    if (configuredAcct && agentWallet.address.toLowerCase() !== configuredAcct.toLowerCase()) {
      throw new Error(
        '[HL] Identidade de transferência inválida: VALIANT_MAIN_KEY_PATH não configurado, ' +
        `agent wallet (${agentWallet.address}) ≠ VALIANT_ACCOUNT_ADDRESS (${configuredAcct}).\n` +
        '  → Crie /opt/bot/secrets/valiant-main-key.txt com o private key da conta principal\n' +
        '    e adicione ao seu arquivo de secrets:\n' +
        '    VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt'
      );
    }

    wallet = agentWallet;
    logger.info('[HL] VALIANT_MAIN_KEY_PATH não configurado — agent wallet usado para transferências (addresses match ✓)');
  }

  // Address match diagnostic — logged after every successful load (public address only).
  const addressMatch = wallet.address.toLowerCase() === configuredAcct.toLowerCase();
  if (!addressMatch) {
    // VALIANT_MAIN_KEY_PATH is set but points to a different address than VALIANT_ACCOUNT_ADDRESS.
    // Warn only: the operator may have an intentional multi-account setup.
    // The transfer will succeed or fail at the API based on the actual account state.
    logger.warn('[HL] ⚠️  Transfer wallet ≠ VALIANT_ACCOUNT_ADDRESS', {
      transferWallet:    wallet.address,
      configuredAccount: configuredAcct,
      hint:              'Verifique se VALIANT_MAIN_KEY_PATH aponta para a chave correta da conta principal.',
    });
  } else {
    logger.info('[HL] Transfer wallet == VALIANT_ACCOUNT_ADDRESS ✓', { address: wallet.address });
  }

  _mainAccountWallet = wallet;
  return _mainAccountWallet;
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
    source:       getHyperliquidChain().toLowerCase() === 'mainnet' ? 'a' : 'b',
    connectionId,
  };

  const sig        = await wallet.signTypedData(domain, types, value);
  const { r, s, v } = ethers.Signature.from(sig);
  return { r, s, v };
}

// ─── EIP-712 signing (Hyperliquid user-signed / "HyperliquidSignTransaction") ─
//
// Used for actions that Hyperliquid validates by recovering the signer address
// directly from the signature (not via the phantom-agent indirection).
// Affected actions: usdClassTransfer, usdSend, withdraw3, vaultTransfer, etc.
//
// Reference: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing
//
// Domain:
//   { name:'HyperliquidSignTransaction', version:'1',
//     chainId:<signatureChainId as decimal int>, verifyingContract:'0x0…0' }
// Types (for usdClassTransfer):
//   { 'HyperliquidTransaction:UsdClassTransfer':
//     [{ name:'hyperliquidChain', type:'string' },
//      { name:'amount',           type:'string' },
//      { name:'toPerp',           type:'bool'   },
//      { name:'nonce',            type:'uint64' }] }
// Signer: main account wallet (NOT the agent wallet)

async function _signUsdClassTransfer(action) {
  const wallet = getMainAccountWallet();

  // signatureChainId may arrive as hex string ('0xa4b1') or decimal string.
  const rawChainId = action.signatureChainId ?? getSignatureChainId();
  const chainId = String(rawChainId).startsWith('0x')
    ? parseInt(String(rawChainId), 16)
    : parseInt(String(rawChainId), 10);

  const domain = {
    name:              'HyperliquidSignTransaction',
    version:           '1',
    chainId,
    verifyingContract: '0x0000000000000000000000000000000000000000',
  };
  // Type name contains a colon — ethers v6 handles this correctly.
  const types = {
    'HyperliquidTransaction:UsdClassTransfer': [
      { name: 'hyperliquidChain', type: 'string' },
      { name: 'amount',           type: 'string' },
      { name: 'toPerp',           type: 'bool'   },
      { name: 'nonce',            type: 'uint64' },
    ],
  };
  // Value contains only the four typed fields — no extra keys.
  const value = {
    hyperliquidChain: action.hyperliquidChain,
    amount:           action.amount,
    toPerp:           action.toPerp,
    nonce:            action.nonce,
  };

  logger.debug('[HL] _signUsdClassTransfer', {
    signingAddress:    wallet.address,
    configuredAccount: getAccountAddress(),
    chainId,
    amount:            action.amount,
    toPerp:            action.toPerp,
  });

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

  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    const snippet = text.slice(0, 500).replace(/\s+/g, ' ').trim();
    throw new Error(
      `[HL] Resposta invalida (HTTP ${res.status}): ${url}` +
      (snippet ? ` | body: ${snippet}` : '')
    );
  }

  return { status: res.status, ok: res.ok, data };
}

/**
 * POST to /exchange — signs the action with EIP-712 before sending.
 * Auth is entirely in the body signature — no Authorization header.
 */
async function _postExchange(action) {
  const nonce     = action?.nonce ?? Date.now();
  const signature = await _signAction(action, nonce);
  const url       = `${getBaseUrl()}/exchange`;

  logger.debug('[HL] POST /exchange →', { action, nonce });

  const { status, ok, data } = await _post(url, { action, nonce, signature });

  logger.debug('[HL] POST /exchange ←', { status, data });

  if (!ok || data?.status === 'err') {
    const detail = data?.response ?? data?.error ?? JSON.stringify(data);
    // Hint at EIP-712 signing misconfiguration when the error looks auth-related.
    const authHint = typeof detail === 'string' && /invalid|agent|auth|sign|unauthorized|Must deposit before performing actions/i.test(detail)
      ? '\n  → Possible Hyperliquid signing error. Orders use the L1/API-wallet signing scheme, but transfers such as usdClassTransfer use the user-signed scheme. Verify the signing method and that the recovered user matches VALIANT_ACCOUNT_ADDRESS.'
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
 *   Close LONG/SHORT: use current mid price plus an aggressive market-close
 *   slippage band, matching Hyperliquid's market-order SDK pattern.
 *
 * @param {{ assetIndex: number, isBuy: boolean, size: string, limitPrice: string, reduceOnly?: boolean }}
 */
export async function placeOrder({ assetIndex, isBuy, size, limitPrice, reduceOnly = false }) {
  const wirePrice = _priceToWire(limitPrice, 'limitPrice');
  const wireSize  = _decimalToWire(size, 'size');

  return _postExchange({
    type:     'order',
    orders: [
      {
        a: assetIndex,
        b: isBuy,
        p: wirePrice,
        s: wireSize,
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
  const referencePx = await _getMidPrice(coinName).catch(() => _positionMarkPrice(pos));
  const closePx = _aggressiveLimitPrice(referencePx, isBuy);

  logger.info('[HL] closePosition market IOC', {
    coinName,
    side: isLong ? 'LONG' : 'SHORT',
    size: absSize,
    referencePx,
    limitPrice: closePx,
    slippagePct: MARKET_CLOSE_SLIPPAGE_PCT,
    assetIndex,
  });

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
  const referencePx = await _getMidPrice(coinName).catch(() => _positionMarkPrice(pos));
  const closePx = _aggressiveLimitPrice(referencePx, isBuy);
  const size    = sizeBase.toFixed(6);

  logger.info('[HL] reducePosition market IOC', {
    coinName,
    side:       isLong ? 'LONG' : 'SHORT',
    reduceSize: size,
    openSize:   openSize.toFixed(6),
    referencePx,
    limitPrice: closePx,
    slippagePct: MARKET_CLOSE_SLIPPAGE_PCT,
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
  // marginSummary (not crossMarginSummary) covers both cross and isolated positions.
  // With isolated margin, crossMarginSummary.totalMarginUsed = 0 for all isolated positions,
  // causing freeCollateral to be overstated. marginSummary is always the correct source.
  const marginSummary = state.marginSummary ?? {};
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
    const triggerPx = _priceToWire(tp, 'tp');
    const limitPx   = _triggerMarketLimitPrice(tp, closeBuy);
    const tpAction = {
      type:     'order',
      orders: [{
        a: assetIndex,
        b: closeBuy,
        p: limitPx,
        s: _decimalToWire(size, 'size'),
        r: true, // reduce-only
        t: { trigger: { isMarket: true, triggerPx, tpsl: 'tp' } },
      }],
      grouping: 'positionTpsl',
    };
    const tpResult = await _postExchange(tpAction).catch((err) => {
      logger.error('[HL] TP order failed', { coinName, action: tpAction, error: err.message });
      throw err;
    });
    const tpSt    = tpResult?.response?.data?.statuses?.[0];
    const tpOid   = String(tpSt?.resting?.oid ?? tpSt?.filled?.oid ?? 'unknown');
    logger.info('[HL] TP order placed', { coinName, tp, orderId: tpOid });
    placed.push({ type: 'tp', price: tp, orderId: tpOid });
  }

  if (sl != null) {
    const triggerPx = _priceToWire(sl, 'sl');
    const limitPx   = _triggerMarketLimitPrice(sl, closeBuy);
    const slAction = {
      type:     'order',
      orders: [{
        a: assetIndex,
        b: closeBuy,
        p: limitPx,
        s: _decimalToWire(size, 'size'),
        r: true,
        t: { trigger: { isMarket: true, triggerPx, tpsl: 'sl' } },
      }],
      grouping: 'positionTpsl',
    };
    const slResult = await _postExchange(slAction).catch((err) => {
      logger.error('[HL] SL order failed', { coinName, action: slAction, error: err.message });
      throw err;
    });
    const slSt    = slResult?.response?.data?.statuses?.[0];
    const slOid   = String(slSt?.resting?.oid ?? slSt?.filled?.oid ?? 'unknown');
    logger.info('[HL] SL order placed', { coinName, sl, orderId: slOid });
    placed.push({ type: 'sl', price: sl, orderId: slOid });
  }

  return placed;
}

/**
 * Returns available USDC balance in the Hyperliquid spot wallet (total minus held in orders).
 * Used by the auto-margin transfer feature to check spot balance before transferring to perps.
 * @returns {Promise<number>} available USDC in spot (0 if not found)
 */
export async function getSpotBalance() {
  const data     = await _postInfo({ type: 'spotClearinghouseState', user: getAccountAddress() });
  const balances = Array.isArray(data?.balances) ? data.balances : [];
  const usdc     = balances.find(b => b.coin === 'USDC');
  if (!usdc) {
    logger.debug('[HL] getSpotBalance: nenhum saldo USDC encontrado em spotClearinghouseState');
    return 0;
  }
  const total = parseFloat(usdc.total ?? '0');
  const hold  = parseFloat(usdc.hold  ?? '0');
  return Math.max(0, total - hold);
}

/**
 * Transfer USDC from the Hyperliquid spot wallet to the perps margin account.
 * This is an L2-internal transfer — no on-chain transaction, no withdrawal.
 *
 * SIGNING SCHEME: usdClassTransfer uses the "HyperliquidSignTransaction" EIP-712 scheme
 * signed by the MAIN ACCOUNT wallet (not the agent wallet used for orders).
 * Hyperliquid recovers the signer address directly from this signature to determine
 * the effective user — sending the wrong signer yields "Must deposit before performing
 * actions. User: <agent-address>" because the agent address has no deposit.
 *
 * This function intentionally does NOT call _postExchange() because that helper always
 * uses the phantom-agent scheme (correct for orders, wrong for transfers).
 *
 * Config required:
 *   VALIANT_MAIN_KEY_PATH  — path to main account private key file (preferred)
 *   VALIANT_ACCOUNT_ADDRESS — expected main account address (used for diagnostics)
 *   If VALIANT_MAIN_KEY_PATH is not set, agent key is used as fallback (only correct
 *   when agent wallet == main account wallet).
 *
 * @param {number} usdAmount — amount to transfer (truncated to 2 decimal places)
 * @throws if amount <= 0 or the exchange rejects the action
 */
export async function transferSpotToPerps(usdAmount) {
  if (usdAmount <= 0) {
    throw new Error(`[HL] transferSpotToPerps: amount deve ser positivo (recebido: ${usdAmount})`);
  }

  const nonce  = Date.now();
  const action = {
    type:             'usdClassTransfer',
    hyperliquidChain: getHyperliquidChain(),
    signatureChainId: getSignatureChainId(),
    amount:           usdAmount.toFixed(2),
    toPerp:           true,
    nonce,
  };

  // Diagnostics logged before any network call — no secrets, public addresses only.
  const mainWallet       = getMainAccountWallet();
  const configuredAccount = getAccountAddress();
  logger.info('[HL] transferSpotToPerps: iniciando', {
    signingAddress:    mainWallet.address,
    configuredAccount,
    addressMatch:      mainWallet.address.toLowerCase() === configuredAccount.toLowerCase(),
    amount:            action.amount,
    toPerp:            action.toPerp,
    hyperliquidChain:  action.hyperliquidChain,
    signatureChainId:  action.signatureChainId,
    nonce,
  });

  const signature = await _signUsdClassTransfer(action);
  const url       = `${getBaseUrl()}/exchange`;

  logger.debug('[HL] POST /exchange (usdClassTransfer) →', { action, nonce });

  const { status, ok, data } = await _post(url, { action, nonce, signature });

  logger.debug('[HL] POST /exchange (usdClassTransfer) ←', { status, data });

  if (!ok || data?.status === 'err') {
    const detail = data?.response ?? data?.error ?? JSON.stringify(data);
    throw new Error(`[HL] transferSpotToPerps error (HTTP ${status}): ${detail}`);
  }

  return data;
}

/**
 * Fetch exchange metadata (market universe).
 * Use this to verify asset indices before trading:
 *   meta.universe.forEach((m, i) => console.log(i, m.name))
 */
export async function fetchMeta() {
  return _postInfo({ type: 'meta' });
}

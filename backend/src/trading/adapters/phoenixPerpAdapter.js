// src/trading/adapters/phoenixPerpAdapter.js
// Phoenix Perps integration adapter.
//
// Official docs: https://docs.phoenix.trade/
//
// ⚠️  STATUS: Phoenix Perps is currently in private beta and requires an
//     access code to use. The full execution API is not publicly documented.
//     This adapter provides the correct interface structure with explicit TODOs
//     for each step once Phoenix Perps becomes publicly accessible.
//
// Known facts from public documentation:
//   - Non-custodial perpetual futures exchange on Solana
//   - Collateral: USDC on Solana
//   - Access is gated (requires access code / allowlist)
//   - REST API: PHOENIX_API_BASE_URL (non-sensitive, set in .env)
//
// SECURITY:
//   - PHOENIX_API_KEY must come from BOT_SECRETS_FILE
//   - PHOENIX_ACCESS_CODE (if required) must come from BOT_SECRETS_FILE
//   - Private keys loaded via walletLoader.js — never stored here
//   - PHOENIX_API_BASE_URL is non-sensitive and can be in .env

import logger from '../../utils/logger.js';
import { resolveWalletForVenue } from '../../wallets/walletResolver.js';

// Conservative static minimums for Phoenix Perps (private beta — 2026-04).
// Phoenix is a CLOB-based perp DEX on Solana; exact on-chain limits are not yet
// publicly documented. Values below mirror Drift's conservative settings for the
// same assets and will be replaced once the Phoenix API exits private beta.
// These constants exist only to satisfy paper mode and risk manager validation —
// live execution for Phoenix remains unimplemented.
const PHOENIX_SUPPORTED_ASSETS = ['SOL', 'BTC', 'ETH'];

const PHOENIX_MAX_LEVERAGE_BY_ASSET = {
  SOL: 20,
  BTC: 20,
  ETH: 20,
};

const PHOENIX_MARKET_LIMITS = {
  SOL: { minBase: 0.1,    stepBase: 0.01   },
  BTC: { minBase: 0.0001, stepBase: 0.0001 },
  ETH: { minBase: 0.001,  stepBase: 0.001  },
};

function getBaseUrl() {
  return (process.env.PHOENIX_API_BASE_URL ?? 'https://api.phoenix.trade').replace(/\/$/, '');
}

function getApiCredentials() {
  // All sensitive values from secrets file (BOT_SECRETS_FILE)
  const apiKey     = process.env.PHOENIX_API_KEY;
  const accessCode = process.env.PHOENIX_ACCESS_CODE;
  return { apiKey, accessCode };
}

function buildHeaders() {
  const { apiKey, accessCode } = getApiCredentials();
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey     && apiKey     !== 'SET_IN_SECRETS_ONLY') headers['X-API-Key']     = apiKey;
  if (accessCode && accessCode !== 'SET_IN_SECRETS_ONLY') headers['X-Access-Code'] = accessCode;
  return headers;
}

export const phoenixPerpAdapter = {
  venue: 'phoenix',

  /**
   * Open a perpetual position on Phoenix Perps.
   *
   * ⚠️  PRIVATE BETA: Full API not publicly documented.
   *
   * TODO: When Phoenix Perps exits private beta and documents the execution API:
   *   1. Authenticate using API key + access code from secrets file
   *   2. POST to `${baseUrl}/orders` with position params
   *   3. Sign the returned transaction with bot wallet (walletLoader)
   *   4. Submit to Solana and confirm
   *   Reference: https://docs.phoenix.trade/
   *
   * @param {object} tradeParams - same schema as drift_executor.openPosition
   * @returns {Promise<object>}
   */
  async openTrade(tradeParams) {
    // Validate wallet is configured — fails fast with a clear error if WALLET_PHOENIX_PATH is missing
    resolveWalletForVenue('phoenix');

    const { asset, direction, entry, leverage, positionSizeUSD, signalId } = tradeParams;

    logger.info(`[PHOENIX] Abrindo posição: ${direction} ${asset} @ $${entry}`, {
      collateral: `$${positionSizeUSD}`,
      leverage:   `${leverage}x`,
      signalId,
    });

    // ── TODO: Implement when Phoenix Perps API is publicly available ──────────
    // const baseUrl = getBaseUrl();
    // const headers = buildHeaders();
    // const keypair = resolveWalletForVenue('phoenix');
    //
    // // 1. Construct order params (exact fields TBD — see docs.phoenix.trade)
    // const orderBody = {
    //   market:     `${asset}-USDC-PERP`,
    //   side:       direction === 'LONG' ? 'bid' : 'ask',
    //   collateral: positionSizeUSD,  // USDC
    //   leverage,
    //   orderType:  'market',
    // };
    //
    // // 2. Submit order
    // const res = await fetch(`${baseUrl}/orders`, {
    //   method: 'POST', headers,
    //   body:   JSON.stringify(orderBody),
    // });
    // if (!res.ok) throw new Error(`Phoenix API error: ${res.status} ${await res.text()}`);
    // const { transaction } = await res.json();
    //
    // // 3. Sign and send
    // // ... sign transaction with keypair and submit to Solana
    // ──────────────────────────────────────────────────────────────────────────

    throw new Error(
      '[PHOENIX] openTrade não implementado — Phoenix Perps está em beta privado. ' +
      'Consulte https://docs.phoenix.trade/ para atualizações sobre acesso público.'
    );
  },

  /**
   * Close an existing Phoenix Perps position.
   *
   * TODO: When Phoenix Perps API is publicly available:
   *   1. GET open positions to find the position for `asset`
   *   2. Submit a close/reduce order
   *   3. Confirm the on-chain transaction
   *
   * @param {string} asset - e.g. 'SOL', 'BTC'
   */
  async closeTrade(asset) {
    logger.info(`[PHOENIX] Fechando posição: ${asset}`);

    // ── TODO: Implement when Phoenix Perps API is publicly available ──────────
    // const baseUrl = getBaseUrl();
    // const headers = buildHeaders();
    //
    // // 1. Find open position
    // const posRes = await fetch(`${baseUrl}/positions?market=${asset}-USDC-PERP`, { headers });
    // const { positions } = await posRes.json();
    // const pos = positions?.find(p => p.isOpen);
    // if (!pos) throw new Error(`[PHOENIX] Sem posição aberta em ${asset}`);
    //
    // // 2. Close
    // const closeRes = await fetch(`${baseUrl}/orders`, {
    //   method: 'POST', headers,
    //   body:   JSON.stringify({ positionId: pos.id, orderType: 'market_close' }),
    // });
    // ...
    // ──────────────────────────────────────────────────────────────────────────

    throw new Error(
      '[PHOENIX] closeTrade não implementado — Phoenix Perps está em beta privado.'
    );
  },

  /**
   * Close all open Phoenix Perps positions.
   * TODO: Iterate over open positions and close each.
   */
  async closeAllTrades() {
    throw new Error(
      '[PHOENIX] closeAllTrades não implementado — Phoenix Perps está em beta privado.'
    );
  },

  /**
   * TODO: Cancel existing TP/SL orders and place new ones on Phoenix Perps.
   * @param {string}      asset
   * @param {number|null} tp
   * @param {number|null} sl
   */
  async updateTpSl(asset, tp, sl) {
    throw new Error(
      '[PHOENIX] updateTpSl não implementado — Phoenix Perps está em beta privado.'
    );
  },

  /**
   * TODO: Return live account snapshot for risk decisions.
   * Should query USDC collateral and open positions via Phoenix Perps API.
   * @returns {Promise<{ freeCollateral: number, totalEquity: number, positionCount: number, totalNotional: number }>}
   */
  async getAccountSnapshot() {
    throw new Error(
      '[PHOENIX] getAccountSnapshot não implementado — Phoenix Perps está em beta privado.'
    );
  },

  /**
   * Returns all asset symbols supported by Phoenix Perps.
   * Static list — see PHOENIX_SUPPORTED_ASSETS above.
   * @returns {string[]}
   */
  getSupportedAssets() {
    return PHOENIX_SUPPORTED_ASSETS;
  },

  /**
   * Returns order size limits for the given asset on Phoenix Perps.
   * Static minimums — see PHOENIX_MARKET_LIMITS above.
   * @param {string} asset
   * @returns {{ minBase: number, stepBase: number }}
   */
  getMarketLimits(asset) {
    const limits = PHOENIX_MARKET_LIMITS[asset?.toUpperCase()];
    if (!limits) {
      throw new Error(`[PHOENIX] Ativo não suportado em getMarketLimits: ${asset}`);
    }
    return limits;
  },

  /**
   * Returns the platform maximum leverage for the given asset on Phoenix Perps.
   * Static values — see PHOENIX_MAX_LEVERAGE_BY_ASSET above.
   * @param {string} asset
   * @returns {number}
   */
  getPlatformMaxLeverage(asset) {
    const max = PHOENIX_MAX_LEVERAGE_BY_ASSET[asset?.toUpperCase()];
    if (max == null) throw new Error(`[PHOENIX] Leverage máxima não configurada para "${asset}". Adicione o ativo em PHOENIX_MAX_LEVERAGE_BY_ASSET.`);
    return max;
  },

  async getBalance() {
    // TODO: Query USDC balance on Solana wallet
    throw new Error('[PHOENIX] getBalance não implementado');
  },
};

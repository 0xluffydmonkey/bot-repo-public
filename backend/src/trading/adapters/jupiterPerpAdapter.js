// src/trading/adapters/jupiterPerpAdapter.js
// Jupiter Perps integration adapter.
//
// Official docs: https://dev.jup.ag/docs/perps
//
// ⚠️  STATUS: The Jupiter Perps REST API is documented as a work in progress.
//     This adapter implements the known interface with clear TODOs for each
//     step that requires a stable API or on-chain instruction building.
//     When the API stabilizes, replace TODOs with working implementations.
//
// SECURITY:
//   - JUPITER_API_KEY (if required) must come from BOT_SECRETS_FILE
//   - Private keys are loaded via walletLoader.js — never stored here
//   - JUPITER_API_BASE_URL is non-sensitive and can be in .env

import fetch from 'node-fetch';
import logger from '../../utils/logger.js';
import { JUPITER_PERPS } from '../../config/index.js';
import { resolveWalletForVenue } from '../../wallets/walletResolver.js';

// Conservative static minimums for Jupiter Perps.
// Based on observed on-chain sizing behaviour (2026-04).
// TODO: replace with live API query once the Jupiter Perps REST API stabilises.
const JUPITER_MARKET_LIMITS = {
  SOL:  { minBase: 0.1,    stepBase: 0.01   },
  BTC:  { minBase: 0.0001, stepBase: 0.0001 },
  ETH:  { minBase: 0.001,  stepBase: 0.001  },
  WIF:  { minBase: 1,      stepBase: 1      },
  BONK: { minBase: 1000,   stepBase: 100    },
  JUP:  { minBase: 1,      stepBase: 1      },
};

// Non-sensitive base URL — can be set in .env
// Sensitive: any API key MUST come from secrets file
function getBaseUrl() {
  return (process.env.JUPITER_API_BASE_URL ?? 'https://api.jup.ag').replace(/\/$/, '');
}

function getApiKey() {
  // API key loaded from secrets file only — never from .env
  const key = process.env.JUPITER_API_KEY;
  return key && key !== 'SET_IN_SECRETS_ONLY' ? key : null;
}

function buildHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  const apiKey  = getApiKey();
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
  return headers;
}

export const jupiterPerpAdapter = {
  venue: 'jupiter',

  /**
   * Open a perpetual position on Jupiter Perps.
   *
   * Jupiter Perps program: PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu
   *
   * Opening a position requires building and submitting an on-chain instruction.
   * The exact REST endpoint for this is documented at:
   * https://dev.jup.ag/docs/perps
   *
   * TODO: When the Jupiter Perps API exposes a stable open-position endpoint:
   *   1. POST to `${baseUrl}/perps/open` with position params
   *   2. Sign the returned transaction with the bot wallet (walletLoader)
   *   3. Submit to Solana and confirm
   *
   * @param {object} tradeParams - same schema as drift_executor.openPosition
   * @returns {Promise<object>}
   */
  async openTrade(tradeParams) {
    // Validate wallet is configured — fails fast with a clear error if WALLET_JUPITER_PATH is missing
    resolveWalletForVenue('jupiter');

    const { asset, direction, entry, tp, sl, leverage, positionSizeUSD, notionalValueUSD, signalId } = tradeParams;

    logger.info(`[JUPITER] Abrindo posição: ${direction} ${asset} @ $${entry}`, {
      notional: `$${notionalValueUSD}`,
      leverage: `${leverage}x`,
      signalId,
    });

    const assetUpper  = asset.toUpperCase();
    const assetMint   = JUPITER_PERPS.ASSET_MINTS[assetUpper];
    const maxLeverage = JUPITER_PERPS.MAX_LEVERAGE_BY_ASSET[assetUpper];

    if (!assetMint) {
      throw new Error(`[JUPITER] Ativo não suportado: ${asset}. Suportados: ${Object.keys(JUPITER_PERPS.ASSET_MINTS).join(', ')}`);
    }
    if (leverage > maxLeverage) {
      throw new Error(`[JUPITER] Leverage ${leverage}x excede máximo permitido para ${asset}: ${maxLeverage}x`);
    }

    // ── TODO: Implement when Jupiter Perps REST API is stable ─────────────────
    // Reference: https://dev.jup.ag/docs/perps
    //
    // Expected flow:
    //   const keypair = resolveWalletForVenue('jupiter');
    //   const baseUrl = getBaseUrl();
    //
    //   // 1. Request open-position instruction
    //   const body = {
    //     owner:      keypair.publicKey.toBase58(),
    //     market:     assetMint,
    //     side:       direction === 'LONG' ? 'long' : 'short',
    //     collateral: Math.round(positionSizeUSD * 1_000_000), // in USDC lamports
    //     leverage:   leverage,
    //     price:      entry,
    //   };
    //   const res = await fetch(`${baseUrl}/perps/open`, {
    //     method:  'POST',
    //     headers: buildHeaders(),
    //     body:    JSON.stringify(body),
    //   });
    //   if (!res.ok) throw new Error(`Jupiter API error: ${res.status}`);
    //   const { transaction } = await res.json();
    //
    //   // 2. Sign and send
    //   const tx = Transaction.from(Buffer.from(transaction, 'base64'));
    //   tx.sign(keypair);
    //   const txSig = await connection.sendRawTransaction(tx.serialize());
    //   await connection.confirmTransaction(txSig);
    //
    //   return { success: true, venue: 'jupiter', signalId, asset, direction, signatures: { marketOrder: txSig } };
    // ──────────────────────────────────────────────────────────────────────────

    throw new Error(
      '[JUPITER] openTrade não implementado — Jupiter Perps REST API está em desenvolvimento. ' +
      'Consulte https://dev.jup.ag/docs/perps para atualizações.'
    );
  },

  /**
   * Close an existing Jupiter Perps position.
   *
   * TODO: When the Jupiter Perps API exposes a stable close-position endpoint:
   *   1. GET positions to find the open position for `asset`
   *   2. POST to `${baseUrl}/perps/close` with the position key
   *   3. Sign the returned transaction and submit to Solana
   *
   * @param {string} asset - e.g. 'SOL', 'BTC'
   */
  async closeTrade(asset) {
    logger.info(`[JUPITER] Fechando posição: ${asset}`);

    // ── TODO: Implement when Jupiter Perps REST API is stable ─────────────────
    // const baseUrl = getBaseUrl();
    // const keypair = loadWalletKeypair();
    //
    // // 1. Get open positions
    // const res = await fetch(`${baseUrl}/perps/positions?owner=${keypair.publicKey.toBase58()}`, {
    //   headers: buildHeaders(),
    // });
    // const { positions } = await res.json();
    //
    // // 2. Find position for the requested asset
    // const pos = positions.find(p => p.market === JUPITER_PERPS.ASSET_MINTS[asset.toUpperCase()]);
    // if (!pos) throw new Error(`[JUPITER] Sem posição aberta em ${asset}`);
    //
    // // 3. Close
    // const closeRes = await fetch(`${baseUrl}/perps/close`, {
    //   method: 'POST', headers: buildHeaders(),
    //   body: JSON.stringify({ positionKey: pos.key }),
    // });
    // const { transaction } = await closeRes.json();
    // // ... sign and send
    // ──────────────────────────────────────────────────────────────────────────

    throw new Error(
      '[JUPITER] closeTrade não implementado — Jupiter Perps REST API está em desenvolvimento.'
    );
  },

  /**
   * Close all open Jupiter Perps positions.
   * TODO: Iterate over open positions and call closeTrade for each.
   */
  async closeAllTrades() {
    throw new Error(
      '[JUPITER] closeAllTrades não implementado — Jupiter Perps REST API está em desenvolvimento.'
    );
  },

  /**
   * TODO: Cancel existing TP/SL orders and place new ones on Jupiter Perps.
   * @param {string}      asset
   * @param {number|null} tp
   * @param {number|null} sl
   */
  async updateTpSl(asset, tp, sl) {
    throw new Error(
      '[JUPITER] updateTpSl não implementado — Jupiter Perps REST API está em desenvolvimento.'
    );
  },

  /**
   * TODO: Return live account snapshot for risk decisions.
   * Should query USDC collateral and open positions via Jupiter Perps API.
   * @returns {Promise<{ freeCollateral: number, totalEquity: number, positionCount: number, totalNotional: number }>}
   */
  async getAccountSnapshot() {
    throw new Error(
      '[JUPITER] getAccountSnapshot não implementado — Jupiter Perps REST API está em desenvolvimento.'
    );
  },

  /**
   * Returns all asset symbols supported by Jupiter Perps.
   * TODO: Replace with live API query when API stabilises.
   * @returns {string[]}
   */
  getSupportedAssets() {
    return Object.keys(JUPITER_PERPS.ASSET_MINTS);
  },

  /**
   * Returns order size limits for the given asset on Jupiter Perps.
   * Values are static minimums — see JUPITER_MARKET_LIMITS above.
   * @param {string} asset
   * @returns {{ minBase: number, stepBase: number }}
   */
  getMarketLimits(asset) {
    const limits = JUPITER_MARKET_LIMITS[asset?.toUpperCase()];
    if (!limits) {
      throw new Error(`[JUPITER] Ativo não suportado em getMarketLimits: ${asset}`);
    }
    return limits;
  },

  /**
   * Returns the platform maximum leverage for the given asset on Jupiter Perps.
   * @param {string} asset
   * @returns {number}
   */
  getPlatformMaxLeverage(asset) {
    return JUPITER_PERPS.MAX_LEVERAGE_BY_ASSET[asset?.toUpperCase()] ?? 10;
  },

  async getBalance() {
    // TODO: Query USDC balance on Solana wallet (used as collateral for Jupiter Perps)
    // const keypair    = loadWalletKeypair();
    // const connection = new Connection(config.solana.rpcUrl);
    // const usdcMint   = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
    // const tokenAccts = await connection.getTokenAccountsByOwner(keypair.publicKey, { mint: usdcMint });
    // ... parse balance
    throw new Error('[JUPITER] getBalance não implementado');
  },
};

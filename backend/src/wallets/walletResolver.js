// src/wallets/walletResolver.js
// Resolves the correct Solana keypair for each trading venue.
//
// Venue-specific wallet paths (set in secrets file — NEVER in .env):
//   WALLET_DRIFT_PATH    → wallet used for Drift trades
//   WALLET_JUPITER_PATH  → wallet used for Jupiter Perps trades
//   WALLET_PHOENIX_PATH  → wallet used for Phoenix Perps trades
//
// Drift fallback:
//   If WALLET_DRIFT_PATH is not set, falls back to BOT_WALLET_PATH.
//   This preserves backward compatibility for existing deployments.
//
// Jupiter / Phoenix:
//   Require an explicit path. Fail fast with a clear error if missing.
//
// SECURITY:
//   - Never reads private key from environment variables
//   - Never logs key material or file contents
//   - Logs only the public key (safe alias) on first resolution
//   - Fails fast with actionable error messages

import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'fs';
import bs58 from 'bs58';
import { loadWalletKeypair } from '../services/walletLoader.js';
import logger from '../utils/logger.js';

// Per-venue cache — each keypair is loaded at most once per process
const _cache = new Map();

/**
 * Parse a keypair from a wallet file.
 * Supports Solana CLI JSON byte-array format and base58 string.
 *
 * @param {string} walletPath - absolute path to the key file
 * @param {string} venue      - venue name used in error messages only
 * @returns {Keypair}
 */
function loadFromPath(walletPath, venue) {
  let fileContent;
  try {
    fileContent = readFileSync(walletPath, 'utf-8').trim();
  } catch (err) {
    throw new Error(
      `[WALLET:${venue.toUpperCase()}] Não foi possível ler o arquivo de wallet: ${err.message}`
    );
  }

  // Try JSON byte array (Solana CLI default: [12, 34, ...])
  try {
    const parsed = JSON.parse(fileContent);
    if (Array.isArray(parsed)) {
      return Keypair.fromSecretKey(Uint8Array.from(parsed));
    }
  } catch (_) {}

  // Try base58 encoded string
  try {
    return Keypair.fromSecretKey(bs58.decode(fileContent));
  } catch (_) {}

  throw new Error(
    `[WALLET:${venue.toUpperCase()}] Formato não reconhecido em "${walletPath}".\n` +
    '  Use JSON byte array (Solana CLI) ou string base58.'
  );
}

/**
 * Returns the Solana Keypair for the given venue.
 *
 * Results are cached per venue — the key file is read at most once per process.
 *
 * @param {'drift'|'jupiter'|'phoenix'} venue
 * @returns {Keypair}
 * @throws {Error} if the wallet path is not configured or the file cannot be loaded
 */
export function resolveWalletForVenue(venue) {
  if (_cache.has(venue)) return _cache.get(venue);

  let keypair;

  if (venue === 'drift') {
    const driftPath = process.env.WALLET_DRIFT_PATH?.trim();
    if (driftPath) {
      keypair = loadFromPath(driftPath, 'drift');
      logger.info(`[WALLET:DRIFT] Wallet carregada via WALLET_DRIFT_PATH — pub: ${keypair.publicKey.toBase58()}`);
    } else {
      // Backward-compatible fallback: use the global BOT_WALLET_PATH
      keypair = loadWalletKeypair();
      logger.info(`[WALLET:DRIFT] Usando BOT_WALLET_PATH (fallback) — pub: ${keypair.publicKey.toBase58()}`);
    }

  } else if (venue === 'jupiter') {
    const jupiterPath = process.env.WALLET_JUPITER_PATH?.trim();
    if (!jupiterPath) {
      throw new Error(
        '[WALLET:JUPITER] WALLET_JUPITER_PATH não está definido.\n' +
        '  Adicione ao arquivo de secrets (BOT_SECRETS_FILE):\n' +
        '  WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json'
      );
    }
    keypair = loadFromPath(jupiterPath, 'jupiter');
    logger.info(`[WALLET:JUPITER] Wallet carregada via WALLET_JUPITER_PATH — pub: ${keypair.publicKey.toBase58()}`);

  } else if (venue === 'phoenix') {
    const phoenixPath = process.env.WALLET_PHOENIX_PATH?.trim();
    if (!phoenixPath) {
      throw new Error(
        '[WALLET:PHOENIX] WALLET_PHOENIX_PATH não está definido.\n' +
        '  Adicione ao arquivo de secrets (BOT_SECRETS_FILE):\n' +
        '  WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json'
      );
    }
    keypair = loadFromPath(phoenixPath, 'phoenix');
    logger.info(`[WALLET:PHOENIX] Wallet carregada via WALLET_PHOENIX_PATH — pub: ${keypair.publicKey.toBase58()}`);

  } else {
    throw new Error(`[WALLET] Venue desconhecida: "${venue}"`);
  }

  _cache.set(venue, keypair);
  return keypair;
}

// src/services/walletLoader.js
// Loads the Solana keypair exclusively from a file pointed to by BOT_WALLET_PATH.
// Supported file formats:
//   - JSON byte array (Solana CLI default): [12, 34, 56, ...]
//   - Base58 string (single line)
//
// SECURITY RULES:
//   - Never reads private key from environment variables
//   - Never logs key material or file contents
//   - Fails fast with a clear message if the path is missing or unreadable

import { Keypair } from '@solana/web3.js';
import { readFileSync } from 'fs';
import bs58 from 'bs58';

let _keypair = null;

export function loadWalletKeypair() {
  if (_keypair) return _keypair;

  const walletPath = process.env.BOT_WALLET_PATH;
  if (!walletPath) {
    throw new Error(
      '[WALLET] BOT_WALLET_PATH não está definido.\n' +
      '  Crie o arquivo da wallet fora do repositório e configure o caminho:\n' +
      '  BOT_WALLET_PATH=/opt/bot/secrets/drift-bot-wallet.json'
    );
  }

  let fileContent;
  try {
    fileContent = readFileSync(walletPath, 'utf-8').trim();
  } catch (err) {
    throw new Error(`[WALLET] Não foi possível ler o arquivo em "${walletPath}": ${err.message}`);
  }

  // Try JSON byte array (Solana CLI format: [12, 34, ...])
  try {
    const parsed = JSON.parse(fileContent);
    if (Array.isArray(parsed)) {
      _keypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
      return _keypair;
    }
  } catch (_) {}

  // Try base58 encoded string
  try {
    _keypair = Keypair.fromSecretKey(bs58.decode(fileContent));
    return _keypair;
  } catch (_) {}

  throw new Error(
    `[WALLET] Formato não reconhecido em "${walletPath}".\n` +
    '  Use JSON byte array (ex: Solana CLI) ou string base58.'
  );
}

// src/config/index.js
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import { validateEnv } from './validateEnv.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.resolve(__dirname, '..', '..');

// ─── 1. Secrets file (MUST be outside the project directory) ─────────────────
// Set BOT_SECRETS_FILE via systemd Environment= or before launching the process.
// This file contains only secret vars and lives at a restricted path like
// /opt/bot/secrets/bot-secrets.env with chmod 600 and owner=bot user.
// dotenv does NOT override values already in process.env, so systemd-injected
// variables always win over file-based ones.
const secretsFilePath = process.env.BOT_SECRETS_FILE?.trim();
let secretsLoadInfo = { path: null, loaded: false, error: null };
if (secretsFilePath) {
  const result = dotenv.config({ path: path.resolve(secretsFilePath) });
  secretsLoadInfo = {
    path:   secretsFilePath,
    loaded: !result.error,
    error:  result.error?.message ?? null,
  };
  if (result.error) {
    console.warn(`[CONFIG] BOT_SECRETS_FILE definido mas não pôde ser lido: ${result.error.message}`);
  } else {
    console.log(`[CONFIG] Secrets carregados de: ${secretsFilePath}`);
  }
}

// ─── 2. Non-secret config (.env inside project — safe to commit if sanitized) ─
const defaultEnvPath = path.join(backendRoot, '.env');
const explicitEnvPath = process.env.BOT_ENV_FILE?.trim();
const envPath = explicitEnvPath ? path.resolve(explicitEnvPath) : defaultEnvPath;
const dotenvResult = dotenv.config({ path: envPath });

validateEnv();

function requireEnv(key) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    throw new Error(`[CONFIG] Variável de ambiente obrigatória não definida: ${key}`);
  }
  return val.trim();
}

function optionalEnv(key, defaultValue) {
  const val = process.env[key];
  return val && val.trim() !== '' ? val.trim() : defaultValue;
}

export const config = {
  // Telegram
  telegram: {
    apiId:     parseInt(requireEnv('TELEGRAM_API_ID'), 10),
    apiHash:   requireEnv('TELEGRAM_API_HASH'),
    phone:     requireEnv('TELEGRAM_PHONE'),
    channelId: requireEnv('TELEGRAM_CHANNEL_ID'),
    // session is NOT stored here — loaded via services/telegramSessionLoader.js
  },

  // Solana
  solana: {
    rpcUrl: requireEnv('SOLANA_RPC_URL'),
    // keypair is NOT stored here — loaded via services/walletLoader.js (BOT_WALLET_PATH)
  },

  // Trading
  trading: {
    paperMode:           optionalEnv('PAPER_TRADING', 'true') === 'true',
    positionSizePct:     parseFloat(optionalEnv('POSITION_SIZE_PCT', '0.05')),
    maxSlippageBps:      parseInt(optionalEnv('MAX_SLIPPAGE_BPS', '100'), 10),
    maxLeverage:         parseFloat(optionalEnv('MAX_LEVERAGE', '20')),
    executionDelayMs:    parseInt(optionalEnv('EXECUTION_DELAY_MS', '0'), 10),
    maxRetries:          parseInt(optionalEnv('MAX_RETRIES', '3'), 10),
    // Limites de risco de portfólio
    maxPositions:        parseInt(optionalEnv('MAX_POSITIONS', '5'), 10),
    minFreeMarginPct:    parseFloat(optionalEnv('MIN_FREE_MARGIN_PCT', '0.10')),
    maxTotalExposurePct: parseFloat(optionalEnv('MAX_TOTAL_EXPOSURE_PCT', '0.80')),
    // Position tracker
    pnlRefreshIntervalMs: parseInt(optionalEnv('PNL_REFRESH_INTERVAL_MS', '30000'), 10),
  },

  // Logs
  log: {
    level: optionalEnv('LOG_LEVEL', 'info'),
    dir:   optionalEnv('LOG_DIR', './logs'),
  },
};

export const runtimePaths = {
  backendRoot,
  envPath,
};

export const envLoadInfo = {
  envPath,
  usedExplicitEnvPath: Boolean(explicitEnvPath),
  loadedFromFile: !dotenvResult.error,
  dotenvError: dotenvResult.error?.message ?? null,
  secretsFile: secretsLoadInfo,
};

// Jupiter Perps - Constantes de plataforma
export const JUPITER_PERPS = {
  // Endereço do programa Jupiter Perpetuals na mainnet
  PROGRAM_ID: 'PERPHjGBqRHArX4DySjwM6UJHiR3sWAatqfdBS2qQJu',

  // Alavancagem máxima por ativo (Jupiter Perps limites reais)
  MAX_LEVERAGE_BY_ASSET: {
    SOL:  100,
    BTC:  100,
    ETH:  100,
    WIF:  50,
    BONK: 50,
    JUP:  50,
  },

  // Mapeamento de símbolo → mint do token
  ASSET_MINTS: {
    SOL:  'So11111111111111111111111111111111111111112',
    BTC:  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E', // wBTC
    ETH:  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs', // wETH
    WIF:  'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
    BONK: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
    JUP:  'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  },
};

export function validateConfig() {
  if (config.trading.positionSizePct <= 0 || config.trading.positionSizePct > 1) {
    throw new Error('[CONFIG] POSITION_SIZE_PCT deve estar entre 0.01 e 1.0');
  }
  if (config.trading.maxLeverage < 1 || config.trading.maxLeverage > 100) {
    throw new Error('[CONFIG] MAX_LEVERAGE deve estar entre 1 e 100');
  }
  return true;
}

// src/trading/position-management/PositionStore.js
// Atomic persistence of position tracking state to disk.
//
// Purpose: survive bot restarts without losing trailing stop levels or alert flags.
// Persists ONLY tracking metadata (price extremes, stop level, alert flag).
// Live position data (size, PnL) always comes from the DEX on reconnect.
//
// Storage: backend/data/positions.json
// Writes:  atomic (write tmp → rename) to avoid partial/corrupt files.

import { writeFileSync, readFileSync, renameSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import logger from '../../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = dirname(__filename);

const DATA_DIR   = join(__dirname, '..', '..', '..', 'data');
const STORE_PATH = join(DATA_DIR, 'positions.json');
const TMP_PATH   = `${STORE_PATH}.tmp`;

// Required fields for a tracking entry to be considered valid on restore
const REQUIRED_FIELDS = ['highestPrice', 'lowestPrice', 'direction'];

function ensureDir() {
  if (!existsSync(DATA_DIR)) mkdirSync(DATA_DIR, { recursive: true });
}

/**
 * Atomically persist the position tracking Map to disk.
 * A failed write logs a warning but never throws — bot must not crash.
 *
 * @param {Map<string, object>} tracking - asset → tracking state
 */
export function savePositionTracking(tracking) {
  try {
    ensureDir();
    const obj = {};
    for (const [asset, track] of tracking.entries()) {
      obj[asset] = { ...track };
    }
    // Atomic: write to .tmp, then rename over the target.
    // rename() is atomic on POSIX (same filesystem).
    writeFileSync(TMP_PATH, JSON.stringify(obj, null, 2), 'utf8');
    renameSync(TMP_PATH, STORE_PATH);
  } catch (err) {
    // Never let a disk write crash the bot
    logger.warn(`[STORE] Falha ao salvar posições: ${err.message}`);
  }
}

/**
 * Load position tracking from disk.
 * Returns an empty Map if the file is missing, corrupted, or contains invalid data.
 * Never throws.
 *
 * @returns {Map<string, object>}
 */
export function loadPositionTracking() {
  if (!existsSync(STORE_PATH)) {
    logger.info('[STORE] Nenhum arquivo de posições encontrado — iniciando vazio');
    return new Map();
  }

  try {
    const raw = readFileSync(STORE_PATH, 'utf8');
    const obj = JSON.parse(raw);

    if (typeof obj !== 'object' || obj === null || Array.isArray(obj)) {
      logger.warn('[STORE] Arquivo de posições com formato inválido — iniciando vazio');
      return new Map();
    }

    const map = new Map();
    let skipped = 0;

    for (const [asset, track] of Object.entries(obj)) {
      const isValid = REQUIRED_FIELDS.every(f => track[f] !== undefined && track[f] !== null);
      if (isValid) {
        map.set(asset, track);
      } else {
        logger.warn(`[STORE] Entrada inválida para ${asset} (campos obrigatórios ausentes) — ignorada`);
        skipped++;
      }
    }

    logger.info(`[STORE] ${map.size} posição(ões) restaurada(s) do disco (${skipped} ignorada(s))`);
    return map;
  } catch (err) {
    logger.warn(`[STORE] Arquivo corrompido ou ilegível — iniciando vazio: ${err.message}`);
    return new Map();
  }
}

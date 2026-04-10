// src/venues/venueBootstrap.js
// Venue-aware startup and shutdown helpers.
//
// Responsibilities:
//   1. Preflight: validate active venue is live-ready + has required capabilities (Phase 1+3)
//   2. initVenueInfra: conditionally initialize heavy infra (e.g. Drift) (Phase 2)
//   3. shutdownVenueInfra: tear down only what was initialized (Phase 2)
//
// CONSTRAINTS:
//   - Does NOT touch PerpExecutionService, paperEngine, or adapters
//   - Does NOT perform any real API calls (no network ping in preflight)
//   - Paper mode: no infra is initialized, no preflight restrictions

import logger from '../utils/logger.js';
import { venueRegistry } from './registerBuiltInVenues.js';
import { initDriftClient, disconnectDrift } from '../executor/drift_executor.js';

// Minimum capabilities required for a venue to be usable in live mode.
const LIVE_REQUIRED_CAPABILITIES = [
  'supportsOpenTrade',
  'supportsCloseTrade',
  'supportsBalance',
  'supportsAccountSnapshot',
];

// Tracks what infra was initialized so shutdown is correct.
let _driftInitialized = false;

// ─── Phase 1 + 3: Preflight ────────────────────────────────────────────────────

/**
 * Validates the active venue before the bot starts accepting trades.
 *
 * In paper mode: logs readiness status only — never blocks.
 * In live mode:
 *   - Fails fast if venue is not liveReady
 *   - Fails fast if venue lacks any LIVE_REQUIRED_CAPABILITIES
 *
 * Does NOT make any network calls.
 *
 * @param {boolean} isPaper - config.trading.paperMode
 * @throws {Error} if live mode and venue is not ready
 */
export function runVenuePreflight(isPaper) {
  const venue     = venueRegistry.getActiveVenue();
  const caps      = venueRegistry.getCapabilities(venue);
  const liveReady = venueRegistry.isLiveReady(venue);
  const mode      = isPaper ? 'paper' : 'live';

  const capList    = Object.entries(caps).filter(([, v]) =>  v).map(([k]) => k.replace('supports', ''));
  const missingCap = Object.entries(caps).filter(([, v]) => !v).map(([k]) => k.replace('supports', ''));

  logger.info(`[BOOT] Venue ativa: ${venue.toUpperCase()}`, {
    modo:        mode,
    paperReady:  true,        // all registered venues work in paper mode
    liveReady,
    suporta:     capList.join(', ')    || '(nenhuma)',
    naoSuporta:  missingCap.join(', ') || '(nenhuma)',
  });

  if (isPaper) {
    logger.info(`[BOOT] Modo paper — validacao de live-readiness ignorada`);
    return;
  }

  // ── Live mode: enforce liveReady ────────────────────────────────────────────
  if (!liveReady) {
    const reason = venueRegistry.getLiveReadyReason(venue)
                ?? 'venue nao declarada como live-ready';
    throw new Error(
      `[BOOT] Venue "${venue}" nao esta pronta para modo LIVE.\n` +
      `  Venue selecionada: ${venue}\n` +
      `  Motivo:            ${reason}\n` +
      `  Acao:              altere PERP_OPEN_VENUE para uma venue live-ready ` +
      `(ex: drift, valiant).`
    );
  }

  // ── Live mode: enforce required capabilities ────────────────────────────────
  const missingRequired = LIVE_REQUIRED_CAPABILITIES.filter((c) => !caps[c]);
  if (missingRequired.length > 0) {
    throw new Error(
      `[BOOT] Venue "${venue}" nao tem capabilities obrigatorias para modo LIVE.\n` +
      `  Venue selecionada:     ${venue}\n` +
      `  Capabilities faltando: ${missingRequired.join(', ')}\n` +
      `  Acao: altere PERP_OPEN_VENUE para uma venue com suporte completo ` +
      `(ex: drift, valiant).`
    );
  }

  logger.info(`[BOOT] Venue "${venue.toUpperCase()}" validada para modo LIVE ✓`);
}

// ─── Phase 2: Venue-aware infra init ──────────────────────────────────────────

/**
 * Initializes only the infrastructure required by the active venue.
 *
 * Current infra tokens:
 *   'drift' → initDriftClient() (Solana RPC + wallet)
 *
 * Valiant and other HTTP-only venues require no special initialization —
 * their clients are lazy-loaded on first request.
 *
 * @param {boolean} isPaper - config.trading.paperMode
 */
export async function initVenueInfra(isPaper) {
  if (isPaper) {
    logger.info('[BOOT] Modo paper — nenhuma infra de venue sera inicializada');
    return;
  }

  const venue    = venueRegistry.getActiveVenue();
  const required = venueRegistry.getRequiredInfra(venue);

  if (required.includes('drift')) {
    logger.info('[BOOT] Inicializando infra Drift (requerida pela venue ativa)...');
    await initDriftClient();
    _driftInitialized = true;
    logger.info('[BOOT] Infra Drift inicializada ✓');
  } else {
    logger.info(`[BOOT] Infra Drift nao requerida para venue "${venue}" — ignorada`);
  }

  if (venue === 'valiant') {
    // No eager init needed — agent key + HTTP client are lazy-loaded on first call.
    // This log confirms the venue is active and ready.
    logger.info('[BOOT] Cliente Valiant pronto (lazy-init no primeiro request) ✓');
  }
}

// ─── Phase 2: Venue-aware infra shutdown ──────────────────────────────────────

/**
 * Tears down only the infrastructure that was initialized.
 * Safe to call even if initVenueInfra was never called.
 */
export async function shutdownVenueInfra() {
  if (_driftInitialized) {
    await disconnectDrift();
    _driftInitialized = false;
  }
}

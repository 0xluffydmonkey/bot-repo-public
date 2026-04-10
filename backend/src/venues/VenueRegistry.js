// src/venues/VenueRegistry.js
// Simple central registry for venue manifests.

import logger from '../utils/logger.js';

const DEFAULT_VENUE = 'drift';
const DEFAULT_CAPABILITIES = {
  supportsOpenTrade: false,
  supportsCloseTrade: false,
  supportsCloseAll: false,
  supportsReduceTrade: false,
  supportsMonitoring: false,
  supportsUpdateTpSl: false,
  supportsAccountSnapshot: false,
  supportsMarketLimits: false,
  supportsBalance: false,
  supportsSupportedAssets: false,
  supportsPlatformMaxLeverage: false,
};

class VenueRegistry {
  constructor() {
    this._venues = new Map();
  }

  registerVenue(manifest) {
    const name = manifest?.name?.toLowerCase?.().trim?.();
    if (!name) {
      throw new Error('[VENUE] Manifest invalido: "name" e obrigatorio');
    }

    this._venues.set(name, {
      name,
      executionAdapter:   manifest.executionAdapter   ?? null,
      monitoringAdapter:  manifest.monitoringAdapter  ?? null,
      capabilities: {
        ...DEFAULT_CAPABILITIES,
        ...(manifest.capabilities ?? {}),
      },
      // Readiness model —————————————————————————————————————————
      // liveReady:          true if the venue is safe for production live trading.
      //                     If false, boot will fail fast in live mode with a clear error.
      // notLiveReadyReason: human-readable explanation surfaced in the boot error.
      // requiredInfra:      list of infra tokens this venue needs at startup.
      //                     Supported tokens: 'drift' (Solana wallet + RPC connection)
      liveReady:          manifest.liveReady          ?? false,
      notLiveReadyReason: manifest.notLiveReadyReason ?? 'venue nao declarada como live-ready',
      requiredInfra:      Array.isArray(manifest.requiredInfra) ? manifest.requiredInfra : [],
    });

    return this._venues.get(name);
  }

  getActiveVenue() {
    const raw = (process.env.PERP_OPEN_VENUE ?? DEFAULT_VENUE).toLowerCase().trim();
    if (this._venues.has(raw)) return raw;

    logger.warn(`[VENUE] PERP_OPEN_VENUE="${raw}" invalido - usando ${DEFAULT_VENUE} como fallback seguro`);
    return DEFAULT_VENUE;
  }

  getExecutionAdapter(venue = this.getActiveVenue()) {
    const manifest = this._venues.get(venue);
    if (!manifest?.executionAdapter) {
      throw new Error(`[VENUE] Execution adapter nao registrado para venue "${venue}"`);
    }
    return manifest.executionAdapter;
  }

  getMonitoringAdapter(venue = this.getActiveVenue()) {
    const manifest = this._venues.get(venue);
    if (!manifest?.monitoringAdapter) {
      throw new Error(`[VENUE] Monitoring adapter nao registrado para venue "${venue}"`);
    }
    return manifest.monitoringAdapter;
  }

  getCapabilities(venue = this.getActiveVenue()) {
    const manifest = this._venues.get(venue);
    if (!manifest) {
      throw new Error(`[VENUE] Manifest nao registrado para venue "${venue}"`);
    }
    return manifest.capabilities;
  }

  supports(venue = this.getActiveVenue(), capability) {
    return Boolean(this.getCapabilities(venue)?.[capability]);
  }

  isLiveReady(venue = this.getActiveVenue()) {
    return Boolean(this._venues.get(venue)?.liveReady);
  }

  getLiveReadyReason(venue = this.getActiveVenue()) {
    return this._venues.get(venue)?.notLiveReadyReason ?? null;
  }

  getRequiredInfra(venue = this.getActiveVenue()) {
    return this._venues.get(venue)?.requiredInfra ?? [];
  }
}

export const venueRegistry = new VenueRegistry();

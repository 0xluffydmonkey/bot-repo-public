// src/venues/manifests/valiantVenue.js
// Valiant venue manifest — production-capable with explicit gating.
//
// Auto-trading gating:
//   Signal auto-execution requires ENABLE_AUTO_TRADING_VALIANT=true in env.
//   Default is blocked. This prevents accidental live execution before the
//   operator confirms the venue is calibrated and monitored.
//
// closeAllTrades: implemented as a sequential per-asset loop (no atomic endpoint).

import { valiantAdapter } from '../../trading/adapters/valiantAdapter.js';
import { valiantMonitoringAdapter } from '../../monitor/venues/valiantMonitoring.js';

export const valiantVenueManifest = {
  name: 'valiant',
  executionAdapter:  valiantAdapter,
  monitoringAdapter: valiantMonitoringAdapter,
  liveReady:          true,
  notLiveReadyReason: null,
  requiredInfra:      [],  // EVM/HTTP only — no Solana wallet or RPC needed
  capabilities: {
    supportsOpenTrade:           true,
    supportsCloseTrade:          true,
    supportsCloseAll:            true,
    supportsReduceTrade:         true,
    supportsMonitoring:          true,
    supportsUpdateTpSl:          true,
    supportsAccountSnapshot:     true,
    supportsMarketLimits:        true,
    supportsBalance:             true,
    supportsSupportedAssets:     true,
    supportsPlatformMaxLeverage: true,
  },
};

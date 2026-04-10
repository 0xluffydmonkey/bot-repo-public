// src/venues/manifests/valiantVenue.js
// Valiant venue manifest — Phase 1 capabilities only.
//
// Deferred to Phase 2:
//   supportsCloseAll, supportsReduceTrade, supportsUpdateTpSl

import { valiantAdapter } from '../../trading/adapters/valiantAdapter.js';
import { valiantMonitoringAdapter } from '../../monitor/venues/valiantMonitoring.js';

export const valiantVenueManifest = {
  name: 'valiant',
  executionAdapter:  valiantAdapter,
  monitoringAdapter: valiantMonitoringAdapter,
  capabilities: {
    supportsOpenTrade:           true,
    supportsCloseTrade:          true,
    supportsCloseAll:            false,
    supportsReduceTrade:         false,
    supportsMonitoring:          true,
    supportsUpdateTpSl:          false,
    supportsAccountSnapshot:     true,
    supportsMarketLimits:        true,
    supportsBalance:             true,
    supportsSupportedAssets:     true,
    supportsPlatformMaxLeverage: true,
  },
};

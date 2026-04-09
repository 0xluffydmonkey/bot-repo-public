// src/venues/manifests/driftVenue.js

import { driftAdapter } from '../../trading/adapters/driftAdapter.js';
import { driftMonitoringAdapter } from '../../monitor/venues/driftMonitoring.js';

export const driftVenueManifest = {
  name: 'drift',
  executionAdapter: driftAdapter,
  monitoringAdapter: driftMonitoringAdapter,
  capabilities: {
    supportsOpenTrade: true,
    supportsCloseTrade: true,
    supportsCloseAll: true,
    supportsMonitoring: true,
    supportsUpdateTpSl: true,
    supportsAccountSnapshot: true,
    supportsMarketLimits: true,
    supportsBalance: true,
    supportsSupportedAssets: true,
    supportsPlatformMaxLeverage: true,
  },
};

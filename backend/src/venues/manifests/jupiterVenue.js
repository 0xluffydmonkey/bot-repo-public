// src/venues/manifests/jupiterVenue.js

import { jupiterPerpAdapter } from '../../trading/adapters/jupiterPerpAdapter.js';
import { jupiterMonitoringAdapter } from '../../monitor/venues/jupiterMonitoring.js';

export const jupiterVenueManifest = {
  name: 'jupiter',
  executionAdapter: jupiterPerpAdapter,
  monitoringAdapter: jupiterMonitoringAdapter,
  capabilities: {
    supportsOpenTrade: false,
    supportsCloseTrade: false,
    supportsCloseAll: false,
    supportsMonitoring: false,
    supportsUpdateTpSl: false,
    supportsAccountSnapshot: false,
    supportsMarketLimits: false,
    supportsBalance: false,
    supportsSupportedAssets: true,
    supportsPlatformMaxLeverage: true,
  },
};

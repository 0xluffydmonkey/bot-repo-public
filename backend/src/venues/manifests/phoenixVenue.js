// src/venues/manifests/phoenixVenue.js

import { phoenixPerpAdapter } from '../../trading/adapters/phoenixPerpAdapter.js';
import { phoenixMonitoringAdapter } from '../../monitor/venues/phoenixMonitoring.js';

export const phoenixVenueManifest = {
  name: 'phoenix',
  executionAdapter: phoenixPerpAdapter,
  monitoringAdapter: phoenixMonitoringAdapter,
  capabilities: {
    supportsOpenTrade: false,
    supportsCloseTrade: false,
    supportsCloseAll: false,
    supportsMonitoring: false,
    supportsUpdateTpSl: false,
    supportsAccountSnapshot: false,
    supportsMarketLimits: true,
    supportsBalance: false,
    supportsSupportedAssets: true,
    supportsPlatformMaxLeverage: true,
  },
};

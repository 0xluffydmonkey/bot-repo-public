// src/venues/manifests/jupiterVenue.js

import { jupiterPerpAdapter } from '../../trading/adapters/jupiterPerpAdapter.js';
import { jupiterMonitoringAdapter } from '../../monitor/venues/jupiterMonitoring.js';

export const jupiterVenueManifest = {
  name: 'jupiter',
  executionAdapter:  jupiterPerpAdapter,
  monitoringAdapter: jupiterMonitoringAdapter,
  liveReady:          false,
  notLiveReadyReason: 'Jupiter Perps REST API nao esta estavel — adapter nao implementado. Use drift ou valiant.',
  requiredInfra:      ['drift'],  // Solana-based: needs wallet + RPC
  capabilities: {
    supportsOpenTrade: false,
    supportsCloseTrade: false,
    supportsCloseAll: false,
    supportsMonitoring: false,
    supportsUpdateTpSl: false,
    supportsAccountSnapshot: false,
    supportsBalance: false,
    supportsSupportedAssets: true,
    supportsPlatformMaxLeverage: true,
    supportsMarketLimits: true,
  },
};

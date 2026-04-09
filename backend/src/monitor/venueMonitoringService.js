// src/monitor/venueMonitoringService.js
// Routes account/position monitoring to the active venue.

import { venueRegistry } from '../venues/registerBuiltInVenues.js';

function requireMonitoringCapability(venue) {
  if (!venueRegistry.supports(venue, 'supportsMonitoring')) {
    throw new Error(`[MONITOR] Venue "${venue}" nao suporta monitoring`);
  }
}

export const venueMonitoringService = {
  async fetchAccountSummary() {
    const venue = venueRegistry.getActiveVenue();
    requireMonitoringCapability(venue);
    const adapter = venueRegistry.getMonitoringAdapter(venue);
    return adapter.fetchAccountSummary();
  },

  async fetchPositions() {
    const venue = venueRegistry.getActiveVenue();
    requireMonitoringCapability(venue);
    const adapter = venueRegistry.getMonitoringAdapter(venue);
    return adapter.fetchPositions();
  },

  async fetchSnapshot() {
    const venue = venueRegistry.getActiveVenue();
    requireMonitoringCapability(venue);
    const adapter = venueRegistry.getMonitoringAdapter(venue);

    if (typeof adapter.fetchSnapshot === 'function') {
      const snapshot = await adapter.fetchSnapshot();
      return { venue, ...snapshot };
    }

    const [account, positions] = await Promise.all([
      adapter.fetchAccountSummary(),
      adapter.fetchPositions(),
    ]);

    return { venue, account, positions };
  },

  getActiveVenue() {
    return venueRegistry.getActiveVenue();
  },

  getCapabilities() {
    return venueRegistry.getCapabilities();
  },
};

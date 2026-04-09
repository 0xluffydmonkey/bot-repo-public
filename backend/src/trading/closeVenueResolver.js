// src/trading/closeVenueResolver.js
// Shared resolver for manual/admin close flows.

import state from '../core/state.js';
import { perpService } from './PerpExecutionService.js';

export function resolveCloseVenue(asset = null, explicitVenue = null, opts = {}) {
  const { allowActiveFallback = true } = opts;

  if (explicitVenue) {
    return { venue: explicitVenue, source: 'explicit' };
  }

  const trackedVenue = asset
    ? state.positions.find((position) => position.asset === asset)?.venue
    : state.positions[0]?.venue;

  if (trackedVenue) {
    return { venue: trackedVenue, source: 'position' };
  }

  if (!allowActiveFallback) {
    return { venue: null, source: 'unresolved' };
  }

  return {
    venue: perpService.getActiveVenue(),
    source: 'active_fallback',
  };
}

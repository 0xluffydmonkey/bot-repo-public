// src/monitor/data_fetcher.js
// Fetches account and position data from the active venue-specific monitoring adapter.
// The returned shape is stable so web/state consumers do not need to know the venue.

import { config }          from '../config/index.js';
import state               from '../core/state.js';
import { venueMonitoringService } from './venueMonitoringService.js';
import { paperEngine }     from '../trading/paperEngine.js';

// ── Paper trading ─────────────────────────────────────────────────────────────
// Reads from paperEngine — the source of truth for paper positions and balance.
// paperEngine.getSnapshot() oscillates markPrice for visual feedback and
// recomputes PnL, mirroring what driftMonitoring does in live mode.
function buildPaperData() {
  const { account, positions } = paperEngine.getSnapshot();

  state.updateAccount({ ...account, isPaper: true });
  state.updatePositions(positions);

  return { timestamp: new Date(), isPaper: true, account, positions };
}

// ── Exportação pública ────────────────────────────────────────────────────────
export async function fetchAccountData() {
  if (config.trading.paperMode) return buildPaperData();

  const { venue, account, positions } = await venueMonitoringService.fetchSnapshot();
  const result = {
    timestamp: new Date(),
    venue,
    isPaper: false,
    account,
    positions,
  };

  state.updateAccount(account);
  state.updatePositions(positions);

  return result;
}

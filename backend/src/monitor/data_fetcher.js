// src/monitor/data_fetcher.js
// Fetches account and position data from the active venue-specific monitoring adapter.
// The returned shape is stable so web/state consumers do not need to know the venue.

import { config }          from '../config/index.js';
import state               from '../core/state.js';
import { venueMonitoringService } from './venueMonitoringService.js';

// ── Mock para paper trading ───────────────────────────────────────────────────
// Simula preços oscillantes para demonstrar todas as features da UI
function buildMockData() {
  const t = Date.now();

  const solPrice = 145 + Math.sin(t / 30_000) * 6;
  const ethPrice = 2340 + Math.sin(t / 25_000) * 55;

  const solEntry = 142.50;
  const ethEntry = 2_360.00;
  const solBase  = 3.45;
  const ethBase  = 0.214;

  const solPnl = (solPrice - solEntry) * solBase;
  const ethPnl = (ethEntry - ethPrice) * ethBase; // SHORT

  const totalEquity    = 1_000 + solPnl + ethPnl;
  const marginUsed     = 650;
  const freeCollateral = Math.max(0, totalEquity - marginUsed);
  const unrealizedPnl  = solPnl + ethPnl;

  const positions = [
    {
      venue: 'drift',
      asset: 'SOL', market: 'SOL-PERP', direction: 'LONG', marketIndex: 0,
      sizeBase: solBase, sizeUSD: solBase * solPrice, collateralUSD: (solBase * solPrice) / 5,
      entryPrice: solEntry, markPrice: solPrice,
      tp: 158.00, sl: 138.00, leverage: 5,
      pnlUSD: solPnl,
      pnlPct: (solPnl / (solEntry * solBase)) * 100,
      isProfit: solPnl >= 0,
    },
    {
      venue: 'drift',
      asset: 'ETH', market: 'ETH-PERP', direction: 'SHORT', marketIndex: 2,
      sizeBase: ethBase, sizeUSD: ethBase * ethPrice, collateralUSD: (ethBase * ethPrice) / 5,
      entryPrice: ethEntry, markPrice: ethPrice,
      tp: 2_180.00, sl: 2_430.00, leverage: 5,
      pnlUSD: ethPnl,
      pnlPct: (ethPnl / (ethEntry * ethBase)) * 100,
      isProfit: ethPnl >= 0,
    },
  ].sort((a, b) => b.pnlUSD - a.pnlUSD);

  const result = {
    timestamp:  new Date(),
    isPaper:    true,
    account:    { freeCollateral, totalEquity, marginUsed, unrealizedPnl },
    positions,
  };

  // Alimenta o state store central
  state.updateAccount({ freeCollateral, totalEquity, marginUsed, unrealizedPnl, isPaper: true });
  state.updatePositions(positions);

  return result;
}

// ── Exportação pública ────────────────────────────────────────────────────────
export async function fetchAccountData() {
  if (config.trading.paperMode) return buildMockData();

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

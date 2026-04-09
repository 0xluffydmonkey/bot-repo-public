// src/monitor/venues/jupiterMonitoring.js
// Monitoring stub for Jupiter Perps.

function notImplemented() {
  throw new Error(
    '[MONITOR/JUPITER] Monitoring nao implementado - adicione fetchAccountSummary/fetchPositions quando a API estabilizar.'
  );
}

export const jupiterMonitoringAdapter = {
  venue: 'jupiter',
  async fetchAccountSummary() {
    notImplemented();
  },
  async fetchPositions() {
    notImplemented();
  },
};

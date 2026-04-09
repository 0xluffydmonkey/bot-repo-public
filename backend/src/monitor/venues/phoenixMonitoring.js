// src/monitor/venues/phoenixMonitoring.js
// Monitoring stub for Phoenix Perps.

function notImplemented() {
  throw new Error(
    '[MONITOR/PHOENIX] Monitoring nao implementado - adicione fetchAccountSummary/fetchPositions quando a venue estiver disponivel.'
  );
}

export const phoenixMonitoringAdapter = {
  venue: 'phoenix',
  async fetchAccountSummary() {
    notImplemented();
  },
  async fetchPositions() {
    notImplemented();
  },
};

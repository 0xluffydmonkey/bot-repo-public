#!/usr/bin/env node

const {
  buildResult,
  addCheck,
  setDetail,
  printSuccess,
  printFailure,
  loadBackendEnv,
  importBackendModule,
  ensure,
} = require('./_shared');

async function main() {
  const envInfo = loadBackendEnv();
  const result = buildResult('Adapter initialization');
  const failures = [];

  const adapterModules = [
    { label: 'drift', path: 'backend/src/trading/adapters/driftAdapter.js', exportName: 'driftAdapter' },
    { label: 'jupiter', path: 'backend/src/trading/adapters/jupiterPerpAdapter.js', exportName: 'jupiterPerpAdapter' },
    { label: 'phoenix', path: 'backend/src/trading/adapters/phoenixPerpAdapter.js', exportName: 'phoenixPerpAdapter' },
  ];

  for (const moduleInfo of adapterModules) {
    try {
      const module = await importBackendModule(moduleInfo.path);
      const adapter = module[moduleInfo.exportName];
      ensure(adapter && typeof adapter.venue === 'string', 'Adapter missing venue');
      ensure(typeof adapter.openTrade === 'function', `${adapter.venue} adapter missing openTrade`);
      ensure(typeof adapter.closeTrade === 'function', `${adapter.venue} adapter missing closeTrade`);
      ensure(typeof adapter.closeAllTrades === 'function', `${adapter.venue} adapter missing closeAllTrades`);
      ensure(typeof adapter.getBalance === 'function', `${adapter.venue} adapter missing getBalance`);
      addCheck(result, moduleInfo.label, 'initialized');
    } catch (error) {
      failures.push(`${moduleInfo.label}: ${error.message}`);
      addCheck(result, moduleInfo.label, `failed: ${error.message}`);
    }
  }

  try {
    const { perpService } = await importBackendModule('backend/src/trading/PerpExecutionService.js');
    ensure(typeof perpService.getActiveVenue === 'function', 'PerpExecutionService missing getActiveVenue');
    addCheck(result, 'perp service', `active venue = ${perpService.getActiveVenue()}`);
  } catch (error) {
    failures.push(`perp service: ${error.message}`);
    addCheck(result, 'perp service', `failed: ${error.message}`);
  }

  setDetail(result, 'envLoad', envInfo);

  if (failures.length > 0) {
    throw new Error(failures.join(' | '));
  }

  printSuccess(result);
}

main().catch((error) => {
  printFailure('Adapter initialization', error);
  process.exitCode = 1;
});

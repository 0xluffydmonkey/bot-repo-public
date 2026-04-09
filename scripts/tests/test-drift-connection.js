#!/usr/bin/env node

const {
  backendRequire,
  buildResult,
  addCheck,
  setDetail,
  printSuccess,
  printFailure,
  loadBackendEnv,
  importBackendModule,
  requireEnv,
  ensure,
} = require('./_shared');

async function main() {
  const envInfo = loadBackendEnv();
  const result = buildResult('Drift connection');

  const { driftAdapter } = await importBackendModule('backend/src/trading/adapters/driftAdapter.js');
  ensure(driftAdapter && driftAdapter.venue === 'drift', 'driftAdapter failed to initialize');
  addCheck(result, 'adapter', 'driftAdapter initialized');

  const rpcUrl = requireEnv('SOLANA_RPC_URL');
  const env = rpcUrl.includes('devnet') ? 'devnet' : 'mainnet-beta';
  addCheck(result, 'rpc', rpcUrl);
  addCheck(result, 'env', env);

  const { Connection, Keypair, PublicKey } = backendRequire('@solana/web3.js');
  const {
    DriftClient,
    Wallet,
    initialize,
    getMarketsAndOraclesForSubscription,
    PRICE_PRECISION,
  } = backendRequire('@drift-labs/sdk');

  const sdkConfig = initialize({ env });
  const marketIndexes = [0, 1, 2];
  const marketConfigs = sdkConfig.PERP_MARKETS.filter((market) => marketIndexes.includes(market.marketIndex));
  const subscriptionConfig = getMarketsAndOraclesForSubscription(env, marketConfigs, []);

  const connection = new Connection(rpcUrl, {
    commitment: 'confirmed',
    wsEndpoint: rpcUrl.replace('https://', 'wss://').replace('http://', 'ws://'),
  });

  const driftClient = new DriftClient({
    connection,
    wallet: new Wallet(Keypair.generate()),
    env,
    programID: new PublicKey(sdkConfig.DRIFT_PROGRAM_ID),
    skipLoadUsers: true,
    activeSubAccountId: 0,
    perpMarketIndexes: subscriptionConfig.perpMarketIndexes,
    spotMarketIndexes: subscriptionConfig.spotMarketIndexes,
    oracleInfos: subscriptionConfig.oracleInfos,
    accountSubscription: {
      type: 'websocket',
      resubTimeoutMs: 15_000,
    },
  });

  try {
    await driftClient.subscribe();

    const slot = await connection.getSlot('confirmed');
    ensure(typeof slot === 'number' && slot > 0, 'RPC slot fetch returned an invalid value');
    addCheck(result, 'rpc connectivity', `slot ${slot}`);

    const markets = marketIndexes.map((marketIndex) => {
      const market = driftClient.getPerpMarketAccount(marketIndex);
      const oracleData = driftClient.getOracleDataForPerpMarket(marketIndex);
      const symbol = market?.name ? Buffer.from(market.name).toString('utf8').replace(/\0/g, '').trim() : `market-${marketIndex}`;
      const price = oracleData?.price ? oracleData.price.toNumber() / PRICE_PRECISION.toNumber() : null;

      ensure(market && typeof market.marketIndex === 'number', `Missing market account for index ${marketIndex}`);
      ensure(price !== null && Number.isFinite(price) && price > 0, `Invalid oracle price for market ${marketIndex}`);

      return {
        marketIndex,
        symbol,
        price: Number(price.toFixed(6)),
      };
    });

    ensure(markets.length === marketIndexes.length, 'Did not fetch all requested Drift markets');
    addCheck(result, 'market fetch', `${markets.length} perp markets loaded`);
    setDetail(result, 'markets', markets);
    setDetail(result, 'envLoad', envInfo);

    printSuccess(result);
  } finally {
    await driftClient.unsubscribe().catch(() => {});
  }
}

main().catch((error) => {
  printFailure('Drift connection', error);
  process.exitCode = 1;
});

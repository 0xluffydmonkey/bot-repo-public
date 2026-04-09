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
  fetchJson,
  fetchText,
} = require('./_shared');

function getHeaders() {
  const headers = {
    accept: 'application/json',
    'content-type': 'application/json',
  };

  const apiKey = process.env.JUPITER_API_KEY && process.env.JUPITER_API_KEY.trim();
  if (apiKey && apiKey !== 'SET_IN_SECRETS_ONLY' && apiKey !== 'SET_IN_SERVER_ONLY') {
    headers.authorization = `Bearer ${apiKey}`;
    headers['x-api-key'] = apiKey;
  }

  return headers;
}

async function main() {
  const envInfo = loadBackendEnv();
  const result = buildResult('Jupiter Perps connection');

  try {
    const { jupiterPerpAdapter } = await importBackendModule('backend/src/trading/adapters/jupiterPerpAdapter.js');
    ensure(jupiterPerpAdapter && jupiterPerpAdapter.venue === 'jupiter', 'jupiterPerpAdapter failed to initialize');
    addCheck(result, 'adapter', 'jupiterPerpAdapter initialized');
  } catch (error) {
    addCheck(result, 'adapter', `init failed: ${error.message}`);
  }

  const baseUrl = (process.env.JUPITER_API_BASE_URL || 'https://api.jup.ag').replace(/\/$/, '');
  addCheck(result, 'base URL', baseUrl);

  const headers = getHeaders();
  const discoveryCandidates = [
    `${baseUrl}/perps/markets`,
    `${baseUrl}/api/perps/markets`,
    `${baseUrl}/v1/perps/markets`,
  ];

  let workingEndpoint = null;
  let responseData = null;
  const failures = [];

  for (const url of discoveryCandidates) {
    try {
      const response = await fetchJson(url, { headers, timeoutMs: 12_000 });
      const data = response.data;
      const markets = Array.isArray(data) ? data : data?.markets;
      ensure(Array.isArray(markets), `Response did not contain a markets array for ${url}`);
      ensure(markets.length > 0, `Markets array was empty for ${url}`);

      const sample = markets[0];
      ensure(typeof sample === 'object' && sample !== null, `First market was not an object for ${url}`);

      workingEndpoint = url;
      responseData = {
        marketCount: markets.length,
        sampleKeys: Object.keys(sample).slice(0, 8),
      };
      break;
    } catch (error) {
      failures.push(`${url} -> ${error.message}`);
    }
  }

  const baseReachability = await fetchText(baseUrl, { headers, timeoutMs: 12_000 }).catch((error) => {
    failures.push(`${baseUrl} -> ${error.message}`);
    return null;
  });

  if (!workingEndpoint) {
    const error = new Error(
      `No Jupiter Perps markets endpoint returned a valid response. Checked: ${failures.join(' | ')}`
    );
    if (failures.some((entry) => entry.includes('401') || entry.includes('403'))) {
      error.status = 401;
    } else if (failures.some((entry) => entry.includes('404') || entry.includes('405'))) {
      error.status = 404;
    }
    throw error;
  }

  addCheck(result, 'endpoint', workingEndpoint);
  addCheck(result, 'market fetch', `${responseData.marketCount} markets`);
  addCheck(result, 'base reachability', baseReachability ? `HTTP ${baseReachability.status}` : 'not checked');
  setDetail(result, 'sample', responseData);
  setDetail(result, 'envLoad', envInfo);

  printSuccess(result);
}

main().catch((error) => {
  printFailure('Jupiter Perps connection', error);
  process.exitCode = 1;
});

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

  const apiKey = process.env.PHOENIX_API_KEY && process.env.PHOENIX_API_KEY.trim();
  const accessCode = process.env.PHOENIX_ACCESS_CODE && process.env.PHOENIX_ACCESS_CODE.trim();

  if (apiKey && apiKey !== 'SET_IN_SECRETS_ONLY' && apiKey !== 'SET_IN_SERVER_ONLY') {
    headers['x-api-key'] = apiKey;
  }
  if (accessCode && accessCode !== 'SET_IN_SECRETS_ONLY' && accessCode !== 'SET_IN_SERVER_ONLY') {
    headers['x-access-code'] = accessCode;
  }

  return headers;
}

async function main() {
  const envInfo = loadBackendEnv();
  const result = buildResult('Phoenix Perps connection');

  try {
    const { phoenixPerpAdapter } = await importBackendModule('backend/src/trading/adapters/phoenixPerpAdapter.js');
    ensure(phoenixPerpAdapter && phoenixPerpAdapter.venue === 'phoenix', 'phoenixPerpAdapter failed to initialize');
    addCheck(result, 'adapter', 'phoenixPerpAdapter initialized');
  } catch (error) {
    addCheck(result, 'adapter', `init failed: ${error.message}`);
  }

  const baseUrl = (process.env.PHOENIX_API_BASE_URL || 'https://api.phoenix.trade').replace(/\/$/, '');
  addCheck(result, 'base URL', baseUrl);

  const headers = getHeaders();
  const discoveryCandidates = [
    `${baseUrl}/markets`,
    `${baseUrl}/perps/markets`,
    `${baseUrl}/api/markets`,
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
      `No Phoenix API endpoint returned a valid markets response. Checked: ${failures.join(' | ')}`
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
  printFailure('Phoenix Perps connection', error);
  process.exitCode = 1;
});

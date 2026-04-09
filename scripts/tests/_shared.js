const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { pathToFileURL } = require('url');

const repoRoot = path.resolve(__dirname, '..', '..');
const backendRoot = path.join(repoRoot, 'backend');
const backendRequire = createRequire(path.join(backendRoot, 'package.json'));

function loadBackendEnv() {
  const dotenv = backendRequire('dotenv');
  const secretsFile = process.env.BOT_SECRETS_FILE && process.env.BOT_SECRETS_FILE.trim();
  const envFile = process.env.BOT_ENV_FILE && process.env.BOT_ENV_FILE.trim()
    ? path.resolve(process.env.BOT_ENV_FILE.trim())
    : path.join(backendRoot, '.env');

  const result = {
    backendRoot,
    envFile,
    envLoaded: false,
    envError: null,
    secretsFile: secretsFile || null,
    secretsLoaded: false,
    secretsError: null,
  };

  if (secretsFile) {
    const loadedSecrets = dotenv.config({ path: path.resolve(secretsFile) });
    result.secretsLoaded = !loadedSecrets.error;
    result.secretsError = loadedSecrets.error ? loadedSecrets.error.message : null;
  }

  const loadedEnv = dotenv.config({ path: envFile });
  result.envLoaded = !loadedEnv.error;
  result.envError = loadedEnv.error ? loadedEnv.error.message : null;

  return result;
}

async function importBackendModule(relativePathFromRepoRoot) {
  const absolutePath = path.join(repoRoot, relativePathFromRepoRoot);
  return import(pathToFileURL(absolutePath).href);
}

function requireEnv(key) {
  const value = process.env[key];
  if (!value || value.trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return value.trim();
}

function buildResult(name) {
  return {
    name,
    checks: [],
    details: {},
  };
}

function addCheck(result, label, value) {
  result.checks.push({ label, value });
}

function setDetail(result, key, value) {
  result.details[key] = value;
}

function printSuccess(result) {
  console.log(`SUCCESS: ${result.name}`);
  result.checks.forEach(({ label, value }) => {
    console.log(`- ${label}: ${value}`);
  });
  const detailKeys = Object.keys(result.details);
  if (detailKeys.length > 0) {
    console.log('- details:');
    detailKeys.forEach((key) => {
      console.log(`  ${key}: ${formatValue(result.details[key])}`);
    });
  }
}

function printFailure(name, error, result) {
  const classification = classifyError(error);
  console.error(`FAILURE: ${name}`);
  console.error(`- type: ${classification.type}`);
  console.error(`- reason: ${classification.reason}`);
  if (classification.status !== null) {
    console.error(`- status: ${classification.status}`);
  }
  if (result) {
    result.checks.forEach(({ label, value }) => {
      console.error(`- ${label}: ${value}`);
    });
  }
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return JSON.stringify(value);
  }
  if (value && typeof value === 'object') {
    return JSON.stringify(value);
  }
  return String(value);
}

function classifyError(error) {
  const status = extractStatus(error);
  const message = error && error.message ? error.message : String(error);
  const lowered = message.toLowerCase();

  if (status === 401 || status === 403 || lowered.includes('unauthorized') || lowered.includes('forbidden')) {
    return { type: 'auth_error', reason: message, status };
  }

  if (
    error?.name === 'AbortError' ||
    ['ENOTFOUND', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(error?.code) ||
    lowered.includes('network') ||
    lowered.includes('fetch failed') ||
    lowered.includes('timed out') ||
    lowered.includes('socket')
  ) {
    return { type: 'connection_error', reason: message, status };
  }

  if (error instanceof SyntaxError || lowered.includes('unexpected token') || lowered.includes('invalid json')) {
    return { type: 'parsing_error', reason: message, status };
  }

  if (status !== null) {
    return { type: 'api_error', reason: message, status };
  }

  return { type: 'unknown_error', reason: message, status };
}

function extractStatus(error) {
  if (typeof error?.status === 'number') {
    return error.status;
  }
  if (typeof error?.response?.status === 'number') {
    return error.response.status;
  }
  return null;
}

function createHttpError(message, status, bodyPreview) {
  const error = new Error(message);
  error.status = status;
  error.bodyPreview = bodyPreview;
  return error;
}

async function fetchJson(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();

    if (!response.ok) {
      throw createHttpError(
        `HTTP ${response.status} from ${url}: ${text.slice(0, 300) || response.statusText}`,
        response.status,
        text.slice(0, 300)
      );
    }

    try {
      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        data: text ? JSON.parse(text) : null,
      };
    } catch (error) {
      const parseError = new SyntaxError(`Invalid JSON from ${url}: ${error.message}`);
      parseError.status = response.status;
      throw parseError;
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs ?? 12_000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) {
      throw createHttpError(
        `HTTP ${response.status} from ${url}: ${text.slice(0, 300) || response.statusText}`,
        response.status,
        text.slice(0, 300)
      );
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      text,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function ensure(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function ensureFileExists(filePath, label) {
  ensure(fs.existsSync(filePath), `${label} not found: ${filePath}`);
}

module.exports = {
  backendRequire,
  backendRoot,
  buildResult,
  addCheck,
  setDetail,
  printSuccess,
  printFailure,
  loadBackendEnv,
  importBackendModule,
  requireEnv,
  classifyError,
  fetchJson,
  fetchText,
  ensure,
  ensureFileExists,
};

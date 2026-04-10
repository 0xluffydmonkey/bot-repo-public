// src/config/validateEnv.js
// Validates required environment variables at boot.
// Fails fast to prevent running with a broken or insecure config.
//
// SECURITY POLICY (enforced here):
//   - WALLET_PRIVATE_KEY in env        → hard error (use BOT_WALLET_PATH)
//   - TELEGRAM_SESSION in env          → hard error (use TELEGRAM_SESSION_PATH)
//   - BOT_WALLET_PATH missing in live  → hard error
//   - Any secret set to placeholder    → hard error (SET_IN_SERVER_ONLY / **)
//   - Any required secret missing      → hard error
//
// HOW TO INJECT SECRETS SECURELY:
//   Option A — systemd (preferred):
//     In your .service unit:
//       Environment="TELEGRAM_API_ID=..."
//       Environment="TELEGRAM_API_HASH=..."
//       ...
//     Or: EnvironmentFile=/opt/bot/secrets/bot-secrets.env  (chmod 600, outside project)
//
//   Option B — external secrets file:
//     BOT_SECRETS_FILE=/opt/bot/secrets/bot-secrets.env
//     The file must be outside the project directory, chmod 600.

// Placeholder sentinel — signals "value not set, must be injected externally"
const PLACEHOLDER = 'SET_IN_SERVER_ONLY';

function isPlaceholder(val) {
  if (!val) return false;
  const v = val.trim();
  return v === PLACEHOLDER || v.startsWith('**');
}

/**
 * Checks a secret env var: must be present and not a placeholder.
 * Pushes a clear error message to `errors` if the check fails.
 * Logs "[CONFIG] Secret loaded: KEY ✓" to console if OK (without the value).
 */
function checkSecret(key, errors) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    errors.push(
      `Missing required secret: ${key}\n` +
      `  → Inject via systemd Environment= or EnvironmentFile=\n` +
      `     OR set BOT_SECRETS_FILE=/opt/bot/secrets/bot-secrets.env`
    );
    return;
  }
  if (isPlaceholder(val)) {
    errors.push(
      `Missing required secret: ${key}\n` +
      `  → Placeholder detected ("${PLACEHOLDER}"). Replace with the real value.\n` +
      `  → Inject via systemd or BOT_SECRETS_FILE — do NOT put real values in .env`
    );
    return;
  }
  console.log(`[CONFIG] Secret loaded: ${key} ✓`);
}

// Non-Solana venues that do not require Solana-specific config.
// Extend this list when new EVM/non-Solana venues are added.
const NON_SOLANA_VENUES = new Set(['valiant']);

export function validateEnv() {
  const isPaper    = process.env.PAPER_TRADING === 'true';
  const controlBot = process.env.ENABLE_CONTROL_BOT === 'true';
  const venue      = (process.env.PERP_OPEN_VENUE ?? 'drift').toLowerCase().trim();
  const isSolana   = !NON_SOLANA_VENUES.has(venue);
  const errors = [];

  // ── Reject deprecated raw-secret patterns ────────────────────────────────

  if (process.env.WALLET_PRIVATE_KEY) {
    errors.push(
      'WALLET_PRIVATE_KEY detectado no ambiente. Esta variável não é mais aceita.\n' +
      '  → Remova do .env e configure:\n' +
      '     BOT_WALLET_PATH=/opt/bot/secrets/drift-bot-wallet.json\n' +
      '  → O arquivo deve conter o keypair em formato JSON ou base58.'
    );
  }

  if (process.env.TELEGRAM_SESSION) {
    errors.push(
      'TELEGRAM_SESSION detectado no ambiente. Esta variável não é mais aceita.\n' +
      '  → Remova do .env e configure:\n' +
      '     TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt\n' +
      '  → Copie o arquivo telegram_session.txt gerado no primeiro boot.'
    );
  }

  // ── Required secrets — must be real values, not placeholders ─────────────

  // SOLANA_RPC_URL is only required for Solana-based venues
  if (isSolana) {
    checkSecret('SOLANA_RPC_URL', errors);
  }

  checkSecret('TELEGRAM_API_ID',  errors);
  checkSecret('TELEGRAM_API_HASH', errors);
  checkSecret('TELEGRAM_PHONE',   errors);

  // Bot control secrets — only required when feature is enabled
  if (controlBot) {
    checkSecret('TELEGRAM_BOT_TOKEN',           errors);
    checkSecret('TELEGRAM_CONTROL_ALLOWED_IDS', errors);
  }

  // ── Solana venue live mode: require wallet path ───────────────────────────

  if (!isPaper && isSolana && !process.env.BOT_WALLET_PATH) {
    errors.push(
      'BOT_WALLET_PATH é obrigatório em modo LIVE (PAPER_TRADING=false).\n' +
      '  → Configure: BOT_WALLET_PATH=/opt/bot/secrets/drift-bot-wallet.json'
    );
  }

  // ── Valiant venue live mode: require agent key + account address ──────────

  if (!isPaper && venue === 'valiant') {
    checkSecret('VALIANT_AGENT_KEY',       errors);
    checkSecret('VALIANT_ACCOUNT_ADDRESS', errors);
  }

  // ── Fail fast ─────────────────────────────────────────────────────────────

  if (errors.length > 0) {
    const lines = errors.map((e, i) => `  [${i + 1}] [CONFIG] ${e}`).join('\n\n');
    throw new Error(`[CONFIG] Erros de configuração encontrados:\n\n${lines}`);
  }
}

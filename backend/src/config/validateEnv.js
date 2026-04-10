// src/config/validateEnv.js
// Validates required environment variables at boot.
// Fails fast to prevent running with a broken or insecure config.
//
// SECURITY POLICY (enforced here):
//   - Any raw secret var in BANNED_RAW_SECRETS → hard error (use the *_PATH var instead)
//   - BOT_WALLET_PATH missing in Solana live   → hard error
//   - Any required *_PATH missing in live mode → hard error
//   - Any secret set to placeholder            → hard error (SET_IN_SERVER_ONLY / **)
//   - Any required secret missing              → hard error
//
// VENUE SECRET CONTRACT (mandatory for all venues):
//   Raw private keys, API secrets, mnemonics, and session strings must NEVER
//   appear in environment variables or .env files.
//   Rule:
//     1. Secret lives in a dedicated file  (chmod 600, outside the repository)
//     2. Env var carries only the *_PATH pointer to that file
//     3. Boot rejects the raw var if detected  (add to BANNED_RAW_SECRETS below)
//     4. Live-mode block requires the *_PATH   (add a checkPath() call below)
//     5. .env / example files document only the path var, never the raw value
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
 * Checks that a *_PATH env var is set (non-empty, non-placeholder).
 * Does NOT verify the file exists — that happens at first use (fail-fast at call site).
 */
function checkPath(key, errors) {
  const val = process.env[key];
  if (!val || val.trim() === '') {
    errors.push(
      `Missing required path: ${key}\n` +
      `  → Set to the absolute path of the secret file:\n` +
      `     ${key}=/opt/bot/secrets/<arquivo>   (chmod 600, fora do repositorio)`
    );
    return;
  }
  if (isPlaceholder(val)) {
    errors.push(
      `Missing required path: ${key}\n` +
      `  → Placeholder detected. Replace with a real file path.`
    );
    return;
  }
  console.log(`[CONFIG] Path configured: ${key} = ${val.trim()} ✓`);
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

// ── Banned raw-secret env vars ────────────────────────────────────────────────
//
// Any var listed here is a hard boot error if present in the environment.
// The raw secret must instead live in a file; the env carries only the *_PATH.
//
// ADDING A NEW VENUE:
//   Append one object: { raw: 'MY_VENUE_SECRET', path: 'MY_VENUE_SECRET_PATH', hint: '...' }
//   Then add checkPath('MY_VENUE_SECRET_PATH', errors) in the venue live-mode block below.
//   Never put the raw value in .env, BOT_SECRETS_FILE, or example configs.
//
const BANNED_RAW_SECRETS = [
  {
    raw:  'WALLET_PRIVATE_KEY',
    path: 'BOT_WALLET_PATH',
    hint: 'O arquivo deve conter o keypair Solana em formato JSON ou base58.',
  },
  {
    raw:  'TELEGRAM_SESSION',
    path: 'TELEGRAM_SESSION_PATH',
    hint: 'Copie o arquivo telegram_session.txt gerado no primeiro boot.',
  },
  // Valiant / Hyperliquid — EVM private key used for EIP-712 phantom-agent signing.
  {
    raw:  'VALIANT_AGENT_KEY',
    path: 'VALIANT_AGENT_KEY_PATH',
    hint: 'Escreva o private key EVM (0x-prefixed hex, 32 bytes) no arquivo.',
  },
];

export function validateEnv() {
  const isPaper    = process.env.PAPER_TRADING === 'true';
  const controlBot = process.env.ENABLE_CONTROL_BOT === 'true';
  const venue      = (process.env.PERP_OPEN_VENUE ?? 'drift').toLowerCase().trim();
  const isSolana   = !NON_SOLANA_VENUES.has(venue);
  const errors = [];

  // ── Block raw secrets in env — keys/mnemonics/sessions must come from files ──
  //
  // EXTENDING: when a new venue uses a key-type secret, add one entry to
  // BANNED_RAW_SECRETS (defined at the bottom of this file) — { raw, path, hint }.
  // No other change needed here.

  for (const { raw, path, hint } of BANNED_RAW_SECRETS) {
    if (process.env[raw]) {
      errors.push(
        `${raw} detectado no ambiente. Raw secrets nao sao aceitos em env vars.\n` +
        `  → Remova ${raw} de qualquer arquivo .env ou secrets.\n` +
        `  → Escreva o segredo em um arquivo dedicado (chmod 600) e configure:\n` +
        `     ${path}=/opt/bot/secrets/<arquivo>\n` +
        `  → ${hint}`
      );
    }
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

  if (!isPaper && isSolana) {
    checkPath('BOT_WALLET_PATH', errors);
  }

  // ── Per-venue live-mode requirements ─────────────────────────────────────────
  //
  // EXTENDING: add a new `if (!isPaper && venue === '<name>') { ... }` block here.
  // Checklist per block:
  //   checkPath('<VENUE>_<SECRET>_PATH', errors)   — for each key-type secret
  //   checkSecret('<VENUE>_<CONFIG>', errors)       — for non-sensitive required vars
  //   direct check for any required URL/config that has no safe default
  //
  // ── Valiant / Hyperliquid ─────────────────────────────────────────────────────
  //
  // Perp execution is routed through Hyperliquid via EIP-712 phantom-agent signing.
  // Agent key is an EVM private key — must live in a file, never in an env var.

  if (!isPaper && venue === 'valiant') {
    // VALIANT_BASE_URL is non-sensitive but MUST be explicitly set.
    // The default (api.hyperliquid.xyz) is used when this is absent,
    // but an explicit value is required to prevent silent misconfiguration.
    if (!process.env.VALIANT_BASE_URL?.trim()) {
      errors.push(
        'VALIANT_BASE_URL e obrigatorio quando PERP_OPEN_VENUE=valiant e PAPER_TRADING=false.\n' +
        '  → Configure em .env:\n' +
        '     VALIANT_BASE_URL=https://api.hyperliquid.xyz'
      );
    }
    // VALIANT_AGENT_KEY_PATH: path to a file containing the EVM private key (0x-prefixed hex, 32 bytes).
    // Generated via: cast wallet new  OR  openssl rand -hex 32
    // Must be pre-authorized on Hyperliquid as an agent for VALIANT_ACCOUNT_ADDRESS.
    checkPath('VALIANT_AGENT_KEY_PATH',    errors);
    checkSecret('VALIANT_ACCOUNT_ADDRESS', errors);
  }

  // ── Fail fast ─────────────────────────────────────────────────────────────

  if (errors.length > 0) {
    const lines = errors.map((e, i) => `  [${i + 1}] [CONFIG] ${e}`).join('\n\n');
    throw new Error(`[CONFIG] Erros de configuração encontrados:\n\n${lines}`);
  }
}

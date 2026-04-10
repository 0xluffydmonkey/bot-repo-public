// src/services/secretFileLoader.js
//
// Generic file-based secret loader for non-Solana credentials.
//
// POLICY:
//   Raw private keys, API secrets, mnemonics, and session strings must NEVER
//   appear in environment variables or .env files.
//   Each secret must live in a dedicated file:
//     • outside the repository
//     • chmod 600, owned by the bot process user
//   The environment carries only the *_PATH pointer to that file.
//
// USAGE:
//   const raw = loadSecretFromFile('VALIANT_AGENT_KEY_PATH', 'Valiant agent key');
//   // → trimmed single-line string from the file, e.g. "0xabc123..."
//
// ADDING A NEW VENUE — checklist (mirrors validateEnv.js VENUE SECRET CONTRACT):
//   1. Write the raw secret to a file outside the repo  (chmod 600)
//   2. Define MY_VENUE_SECRET_PATH in .env / BOT_SECRETS_FILE (path only — non-sensitive)
//   3. Call loadSecretFromFile('MY_VENUE_SECRET_PATH', 'description') in the client
//   4. Add { raw:'MY_VENUE_SECRET', path:'MY_VENUE_SECRET_PATH', hint:'...' }
//      to BANNED_RAW_SECRETS in validateEnv.js
//   5. Add checkPath('MY_VENUE_SECRET_PATH', errors) to the venue live-mode block
//      in validateEnv.js
//   6. .env and any example configs must document only the _PATH var, never the value
//   Never put the secret value itself in any env var.
//
// SECURITY:
//   - File content is never logged
//   - Only the first 8 chars + length are logged as a non-sensitive confirmation
//   - Fails fast with an actionable error if the path var is unset or the file
//     is missing / unreadable / empty

import { readFileSync } from 'fs';
import logger from '../utils/logger.js';

/**
 * Load a single-line secret from a file pointed to by an env var.
 *
 * @param {string} pathEnvVar   - name of the env var that holds the file path
 *                                e.g. 'VALIANT_AGENT_KEY_PATH'
 * @param {string} description  - human label used in error messages and logs
 *                                e.g. 'Valiant agent private key'
 * @returns {string}            - trimmed file content (single line)
 * @throws {Error}              - fails fast if path unset, file unreadable, or content empty
 */
export function loadSecretFromFile(pathEnvVar, description) {
  const filePath = process.env[pathEnvVar]?.trim();

  if (!filePath) {
    throw new Error(
      `[SECRET] ${pathEnvVar} nao definido.\n` +
      `  Crie o arquivo contendo o ${description} e configure o caminho:\n` +
      `  ${pathEnvVar}=/opt/bot/secrets/<arquivo>   (chmod 600, fora do repositorio)`
    );
  }

  let content;
  try {
    content = readFileSync(filePath, 'utf-8').trim();
  } catch (err) {
    throw new Error(
      `[SECRET] Nao foi possivel ler ${description} em "${filePath}": ${err.message}\n` +
      `  Verifique: arquivo existe, permissoes (chmod 600), usuario correto.`
    );
  }

  if (!content) {
    throw new Error(
      `[SECRET] Arquivo de ${description} esta vazio: "${filePath}"\n` +
      `  Escreva o segredo no arquivo e tente novamente.`
    );
  }

  // Log only a non-sensitive confirmation — never the content
  logger.info(`[SECRET] ${description} carregado de "${filePath}" (${content.length} chars, prefixo: ${content.slice(0, 8)}…)`);
  return content;
}

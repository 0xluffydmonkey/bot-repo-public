// src/services/telegramSessionLoader.js
// Loads the Telegram MTProto session string from a file.
// Resolution order (first non-empty string wins):
//   1. File at TELEGRAM_SESSION_PATH  (preferred — file outside repo)
//   2. ./telegram_session.txt         (auto-saved on first login; migrate to TELEGRAM_SESSION_PATH after first boot)
//
// Returns empty string '' on first boot (triggers interactive Telegram login).
// Raw TELEGRAM_SESSION env var is NO LONGER supported — see validateEnv.js.
//
// SECURITY RULES:
//   - Never logs session string content
//   - Never reads session from environment variables

import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { runtimePaths } from '../config/index.js';

function resolveSessionPath(sessionPath) {
  return path.isAbsolute(sessionPath)
    ? sessionPath
    : path.resolve(runtimePaths.backendRoot, sessionPath);
}

export function loadTelegramSession(logger) {
  const log = logger ?? console;

  // 1. Preferred: explicit path outside repo
  const sessionPath = process.env.TELEGRAM_SESSION_PATH;
  if (sessionPath) {
    const resolvedPath = resolveSessionPath(sessionPath);
    try {
      const session = readFileSync(resolvedPath, 'utf-8').trim();
      if (session.length > 10) {
        log.info(`[TELEGRAM] Sessão carregada de TELEGRAM_SESSION_PATH`, {
          configuredPath: sessionPath,
          resolvedPath,
        });
        return session;
      }
      log.warn(`[TELEGRAM] Arquivo em TELEGRAM_SESSION_PATH existe mas está vazio`, {
        configuredPath: sessionPath,
        resolvedPath,
      });
    } catch (err) {
      log.warn(`[TELEGRAM] Falha ao ler TELEGRAM_SESSION_PATH`, {
        configuredPath: sessionPath,
        resolvedPath,
        error: err.message,
      });
    }
  }

  // 2. Fallback: local auto-saved session (preserved for first-boot compatibility)
  const localFile = path.join(runtimePaths.backendRoot, 'telegram_session.txt');
  if (existsSync(localFile)) {
    try {
      const session = readFileSync(localFile, 'utf-8').trim();
      if (session.length > 10) {
        log.info(`[TELEGRAM] Sessão carregada de ${localFile}`);
        log.warn(
          `[TELEGRAM] 💡 Mova a sessão para fora do repositório e defina TELEGRAM_SESSION_PATH:\n` +
          `  mv ${localFile} /opt/bot/secrets/telegram_session.txt\n` +
          `  TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt`
        );
        return session;
      }
    } catch (err) {
      log.warn(`[TELEGRAM] Falha ao ler ${localFile}: ${err.message}`);
    }
  }

  // No session found — first boot, interactive login will be triggered
  log.info(`[TELEGRAM] Nenhuma sessão encontrada — login interativo será solicitado`);
  return '';
}

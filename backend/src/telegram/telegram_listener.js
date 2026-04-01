// src/telegram/telegram_listener.js
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { NewMessage } from "telegram/events/index.js";
import * as readlineSync from "readline-sync";
import fs from "fs";
import path from "path";
import logger from "../utils/logger.js";
import { config, runtimePaths } from "../config/index.js";
import { loadTelegramSession } from "../services/telegramSessionLoader.js";

// readline-sync é síncrono mas funciona perfeitamente aqui pois
// só é chamado UMA vez durante o boot (autenticação inicial).
// hideEchoBack: true → suprime completamente os caracteres no terminal
// mask: ''           → não mostra nem asteriscos

function promptText(question) {
  return readlineSync.question(question);
}

function promptPassword(question) {
  return readlineSync.question(question, { hideEchoBack: true, mask: "" });
}

// ─── Sessão persistida ────────────────────────────────────────────────────────
function loadSession() {
  return loadTelegramSession(logger);
}

function resolveSessionSavePath(savePath) {
  return path.isAbsolute(savePath)
    ? savePath
    : path.resolve(runtimePaths.backendRoot, savePath);
}

function saveSession(sessionStr) {
  const savePath = process.env.TELEGRAM_SESSION_PATH;
  if (!savePath) {
    logger.warn(
      '[TELEGRAM] TELEGRAM_SESSION_PATH não definido — sessão não será persistida.\n' +
      '  Configure TELEGRAM_SESSION_PATH para evitar novo login a cada boot.'
    );
    return;
  }
  const resolvedSavePath = resolveSessionSavePath(savePath);
  fs.writeFileSync(resolvedSavePath, sessionStr, { mode: 0o600 });
  logger.info('[TELEGRAM] Sessão persistida em TELEGRAM_SESSION_PATH', {
    configuredPath: savePath,
    resolvedPath: resolvedSavePath,
  });
  // NOTE: session path and string are NOT logged — they are secret credentials
}

// ─── Listener principal ───────────────────────────────────────────────────────
export async function startTelegramListener(onSignalMessage) {
  const sessionStr = loadSession();
  if (!sessionStr && !process.stdin.isTTY) {
    throw new Error(
      '[TELEGRAM] Nenhuma sessão carregada e o processo não possui terminal interativo.\n' +
      '  Faça o primeiro login manualmente em uma sessão com TTY e persista o arquivo definido em TELEGRAM_SESSION_PATH.'
    );
  }

  const session = new StringSession(sessionStr);

  const client = new TelegramClient(
    session,
    config.telegram.apiId,
    config.telegram.apiHash,
    {
      connectionRetries: 10,
      retryDelay: 2000,
      autoReconnect: true,
      useWSS: true,
    },
  );

  logger.info(`[TELEGRAM] Conectando...`);
  logger.info('[TELEGRAM] Bootstrap', {
    channelId: config.telegram.channelId,
    phoneConfigured: Boolean(config.telegram.phone),
    sessionConfigured: Boolean(process.env.TELEGRAM_SESSION_PATH),
    sessionLoaded: Boolean(sessionStr),
    hasInteractiveTTY: Boolean(process.stdin.isTTY),
    cwd: process.cwd(),
  });

  await client.start({
    phoneNumber: async () => config.telegram.phone,
    phoneCode: async () => {
      logger.info(`[TELEGRAM] ⚠️  Digite o código enviado pelo Telegram:`);
      return promptText("Código: ");
    },
    password: async () => {
      logger.info(`[TELEGRAM] 🔐 Digite sua senha 2FA (oculta):`);
      return promptPassword("Senha 2FA: ");
    },
    onError: (err) => logger.error(`[TELEGRAM] Erro: ${err.message}`),
  });

  logger.info(`[TELEGRAM] ✅ Autenticado com sucesso!`);

  const newSession = client.session.save();
  if (newSession !== sessionStr) saveSession(newSession);

  // ─── Resolver canal alvo ──────────────────────────────────────────────────
  let targetEntity;
  try {
    targetEntity = await client.getEntity(config.telegram.channelId);
    logger.info(
      `[TELEGRAM] Canal: "${targetEntity.title ?? targetEntity.username}" (ID: ${targetEntity.id})`,
    );
  } catch (err) {
    logger.error(`[TELEGRAM] Canal não encontrado: ${err.message}`);
    throw err;
  }

  // ─── Handler de mensagens ──────────────────────────────────────────────────
  client.addEventHandler(async (event) => {
    try {
      const message = event.message;
      if (!message?.text) return;

      const chatId = message.chatId?.toString();
      const entityId = targetEntity.id?.toString();
      const matches =
        chatId === entityId ||
        chatId === `-100${entityId}` ||
        entityId === chatId?.replace("-100", "");

      if (!matches) return;

      await onSignalMessage(message.text, {
        msgId: message.id,
        msgDate: new Date(message.date * 1000).toISOString(),
      });
    } catch (err) {
      logger.error(`[TELEGRAM] Erro ao processar mensagem: ${err.message}`);
    }
  }, new NewMessage({}));

  logger.info(`[TELEGRAM] 🔊 Monitorando em tempo real...`);
  return client;
}

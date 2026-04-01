// src/web/server.js
// Dashboard web em tempo real via Express + Socket.IO
// Serve arquivos estáticos de src/web/public/ e transmite state via WebSocket.

import express   from 'express';
import { createServer } from 'http';
import { Server as SocketIO } from 'socket.io';
import { fileURLToPath } from 'url';
import { dirname, join }  from 'path';
import state from '../core/state.js';
import logger from '../utils/logger.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function createWebServer(port = 3000, host = process.env.WEB_HOST || undefined) {
  const app        = express();
  const httpServer = createServer(app);
  const staticRoot = join(__dirname, 'public');
  const io         = new SocketIO(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
  });

  app.use(express.json());
  app.use(express.static(staticRoot));

  // ── REST: consultas ────────────────────────────────────────────────────────
  app.get('/api/state', (_req, res) => res.json(state.getSnapshot()));

  // ── REST: controles ────────────────────────────────────────────────────────
  app.post('/api/pause', (_req, res) => {
    state.setPaused(true);
    logger.info('[WEB] Comando: pausar');
    res.json({ ok: true, paused: true });
  });

  app.post('/api/resume', (_req, res) => {
    state.setPaused(false);
    logger.info('[WEB] Comando: retomar');
    res.json({ ok: true, paused: false });
  });

  app.post('/api/autotrading', (req, res) => {
    const enabled = req.body?.enabled ?? true;
    state.setAutoTrading(Boolean(enabled));
    logger.info(`[WEB] Comando: auto-trading ${enabled ? 'ON' : 'OFF'}`);
    res.json({ ok: true, autoTrading: Boolean(enabled) });
  });

  app.post('/api/close', async (req, res) => {
    const { asset } = req.body ?? {};
    if (!asset) return res.status(400).json({ ok: false, error: 'asset obrigatório' });
    logger.info(`[WEB] Comando: fechar ${asset}`);
    state.emit('cmd:close', { asset });
    res.json({ ok: true, asset });
  });

  app.post('/api/close_all', (_req, res) => {
    logger.info('[WEB] Comando: fechar todas as posições');
    state.emit('cmd:close_all');
    res.json({ ok: true });
  });

  // ── SPA fallback ───────────────────────────────────────────────────────────
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/socket.io')) return next();
    if (req.path.includes('.')) return next();
    res.sendFile(join(staticRoot, 'index.html'));
  });

  // ── Socket.IO ──────────────────────────────────────────────────────────────
  io.on('connection', (socket) => {
    logger.info(`[WEB] Cliente conectado: ${socket.id}`);

    // Envia estado atual imediatamente ao conectar
    socket.emit('state', state.getSnapshot());

    // Retransmite atualizações do state store
    const onUpdate = (snapshot) => socket.emit('state', snapshot);
    state.on('update', onUpdate);

    socket.on('disconnect', () => {
      state.off('update', onUpdate);
      logger.info(`[WEB] Cliente desconectado: ${socket.id}`);
    });

    // Comandos via socket (alternativa ao REST)
    socket.on('cmd:pause',       ()          => state.setPaused(true));
    socket.on('cmd:resume',      ()          => state.setPaused(false));
    socket.on('cmd:autotrading', ({ enabled }) => state.setAutoTrading(Boolean(enabled)));
    socket.on('cmd:close',       ({ asset }) => state.emit('cmd:close', { asset }));
    socket.on('cmd:close_all',   ()          => state.emit('cmd:close_all'));
  });

  httpServer.listen(port, host, () => {
    const address = httpServer.address();
    const boundHost =
      typeof address === 'object' && address?.address
        ? address.address
        : (host || '0.0.0.0');

    logger.info('[WEB] Dashboard online', {
      port,
      host: boundHost,
      staticRoot,
      apiBase: '/api',
      socketPath: '/socket.io',
    });
  });

  return httpServer;
}

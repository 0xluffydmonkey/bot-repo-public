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
import { resolveCloseVenue } from '../trading/closeVenueResolver.js';
import { openManualTrade, updateManualTpSl, reduceManualTrade } from '../trading/ManualTradeService.js';
import { persistenceService } from '../services/persistenceService.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Autenticação de ações críticas ────────────────────────────────────────────
//
// Comportamento (em ordem de prioridade):
//   1. Se WEB_API_TOKEN está definido (no secrets file): exige o header
//      X-API-Token: <token> em QUALQUER origem. Sem ele → 401.
//   2. Se WEB_API_TOKEN não está definido: aceita apenas requisições de
//      localhost (127.0.0.1 / ::1). Requisições externas → 403.
//
// Isso protege ações críticas sem exigir configuração extra em dev local.
// Para acesso remoto: defina WEB_API_TOKEN no secrets file.
//
// GET /api/state e leitura via Socket.IO NÃO são afetados — permanecem abertos.
//
function requireActionAuth(req, res, next) {
  const token = process.env.WEB_API_TOKEN;

  if (token) {
    // Modo com token configurado: exige header em qualquer origem
    const provided = req.headers['x-api-token'];
    if (!provided || provided !== token) {
      logger.warn(`[WEB] ⛔ Ação crítica bloqueada: token inválido ou ausente (${req.method} ${req.path})`);
      return res.status(401).json({ ok: false, error: 'Token inválido ou ausente (header X-API-Token)' });
    }
    return next();
  }

  // Modo sem token: permitir apenas localhost
  const raw = req.ip ?? req.socket?.remoteAddress ?? '';
  // Express pode prefixar com ::ffff: em IPv4-mapped IPv6
  const ip  = raw.replace(/^::ffff:/, '');
  const isLocalhost = ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';

  if (!isLocalhost) {
    logger.warn(`[WEB] ⛔ Ação crítica bloqueada: origem não-localhost sem token (ip=${ip}, ${req.method} ${req.path})`);
    return res.status(403).json({
      ok: false,
      error: 'Acesso a ações críticas restrito a localhost. Configure WEB_API_TOKEN no secrets file para acesso remoto.',
    });
  }

  next();
}

// ── Verificação de autorização para comandos Socket.IO críticos ───────────────
function isSocketAuthorized(socket) {
  const token = process.env.WEB_API_TOKEN;

  if (token) {
    // Token configurado: exige auth.token no handshake ou header x-api-token
    const provided = socket.handshake.auth?.token
      ?? socket.handshake.headers?.['x-api-token'];
    return provided === token;
  }

  // Sem token: permitir apenas localhost
  const raw = socket.handshake.address ?? '';
  const ip  = raw.replace(/^::ffff:/, '');
  return ip === '127.0.0.1' || ip === '::1' || ip === 'localhost';
}

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

  // Métricas resumidas de trades — leitura pura, sem autenticação.
  // Query param: ?mode=live (default) | paper | all
  app.get('/api/metrics/summary', async (req, res) => {
    const { mode } = req.query;
    const data = await persistenceService.getMetricsSummary(mode);
    const resolvedMode = (mode === 'paper' || mode === 'all') ? mode : 'live';
    res.json({ ok: true, mode: resolvedMode, data });
  });

  // Performance por ativo — leitura pura, sem autenticação.
  // Query param: ?mode=live (default) | paper | all
  app.get('/api/metrics/by-symbol', async (req, res) => {
    const { mode } = req.query;
    const data = await persistenceService.getMetricsBySymbol(mode);
    const resolvedMode = (mode === 'paper' || mode === 'all') ? mode : 'live';
    res.json({ ok: true, mode: resolvedMode, data });
  });

  // PnL timeseries agrupado por dia — leitura pura, sem autenticação.
  // Query param: ?mode=live (default) | paper | all
  app.get('/api/metrics/pnl-timeseries', async (req, res) => {
    const { mode } = req.query;
    const data = await persistenceService.getPnlTimeseries(mode);
    const resolvedMode = (mode === 'paper' || mode === 'all') ? mode : 'live';
    res.json({ ok: true, mode: resolvedMode, data });
  });

  // Distribuição de resultados por buckets de PnL — leitura pura, sem autenticação.
  // Query param: ?mode=live (default) | paper | all
  app.get('/api/metrics/distribution', async (req, res) => {
    const { mode } = req.query;
    const data = await persistenceService.getMetricsDistribution(mode);
    const resolvedMode = (mode === 'paper' || mode === 'all') ? mode : 'live';
    res.json({ ok: true, mode: resolvedMode, data });
  });

  // Performance por side (LONG/SHORT) — leitura pura, sem autenticação.
  // Query param: ?mode=live (default) | paper | all
  app.get('/api/metrics/by-side', async (req, res) => {
    const { mode } = req.query;
    const data = await persistenceService.getMetricsBySide(mode);
    const resolvedMode = (mode === 'paper' || mode === 'all') ? mode : 'live';
    res.json({ ok: true, mode: resolvedMode, data });
  });

  // Métricas de risco/qualidade da estratégia — leitura pura, sem autenticação.
  // Query param: ?mode=live (default) | paper | all
  app.get('/api/metrics/risk', async (req, res) => {
    const { mode } = req.query;
    const data = await persistenceService.getRiskMetrics(mode);
    const resolvedMode = (mode === 'paper' || mode === 'all') ? mode : 'live';
    res.json({ ok: true, mode: resolvedMode, data });
  });

  // Insights determinísticos baseados nas métricas existentes — leitura pura, sem autenticação.
  // Query param: ?mode=live (default) | paper | all
  app.get('/api/metrics/insights', async (req, res) => {
    const { mode } = req.query;
    const data = await persistenceService.getMetricsInsights(mode);
    const resolvedMode = (mode === 'paper' || mode === 'all') ? mode : 'live';
    res.json({ ok: true, mode: resolvedMode, insights: data.insights });
  });

  // Retorna auditoria consolidada de um trade por bot_trade_ref.
  // Leitura pura — sem autenticação (mesma política de /api/state).
  // Retorna 404 quando o ref não corresponde a nenhum trade no banco.
  app.get('/api/audit/:botTradeRef', async (req, res) => {
    const { botTradeRef } = req.params;
    const audit = await persistenceService.getTradeAuditByRef(botTradeRef);
    if (!audit || !audit.trade) return res.status(404).json({ ok: false, error: 'Trade não encontrado para este bot_trade_ref' });
    res.json({ ok: true, ...audit });
  });

  // ── REST: controles ────────────────────────────────────────────────────────
  app.post('/api/pause', requireActionAuth, (_req, res) => {
    state.setPaused(true);
    logger.info('[WEB] Comando: pausar');
    res.json({ ok: true, paused: true });
  });

  app.post('/api/resume', requireActionAuth, (_req, res) => {
    state.setPaused(false);
    logger.info('[WEB] Comando: retomar');
    res.json({ ok: true, paused: false });
  });

  app.post('/api/autotrading', requireActionAuth, (req, res) => {
    const enabled = req.body?.enabled ?? true;
    state.setAutoTrading(Boolean(enabled));
    logger.info(`[WEB] Comando: auto-trading ${enabled ? 'ON' : 'OFF'}`);
    res.json({ ok: true, autoTrading: Boolean(enabled) });
  });

  app.post('/api/intake', requireActionAuth, (req, res) => {
    const enabled = req.body?.enabled ?? true;
    state.setSignalIntakeEnabled(Boolean(enabled));
    logger.info(`[WEB] Comando: signal intake ${enabled ? 'ON' : 'OFF'}`);
    res.json({ ok: true, signalIntakeEnabled: Boolean(enabled) });
  });

  app.post('/api/close', requireActionAuth, async (req, res) => {
    const { asset, venue } = req.body ?? {};
    if (!asset) return res.status(400).json({ ok: false, error: 'asset obrigatório' });
    const { venue: resolvedVenue } = resolveCloseVenue(asset, venue, { allowActiveFallback: false });
    logger.info(`[WEB] Comando: fechar ${asset} a mercado`, { venue: resolvedVenue ?? '(ativa)' });
    // cmd:close é sempre fechamento total a mercado e executa de forma assíncrona pelo handler em index.js
    state.emit('cmd:close', { asset, venue: resolvedVenue });
    res.json({ ok: true, async: true, asset, venue: resolvedVenue, note: 'Comando enviado. Resultado disponível via /api/state ou WebSocket.' });
  });

  app.post('/api/close_all', requireActionAuth, (req, res) => {
    const { venue } = req.body ?? {};
    const { venue: resolvedVenue } = resolveCloseVenue(null, venue, { allowActiveFallback: false });
    logger.info('[WEB] Comando: fechar todas as posições a mercado', { venue: resolvedVenue ?? '(ativa)' });
    // cmd:close_all fecha posições a mercado e executa de forma assíncrona pelo handler em index.js
    state.emit('cmd:close_all', { venue: resolvedVenue });
    res.json({ ok: true, async: true, venue: resolvedVenue, note: 'Comando enviado. Resultado disponível via /api/state ou WebSocket.' });
  });

  // ── REST: execução manual ──────────────────────────────────────────────────

  // Abrir posição manualmente — síncrono: aguarda execução real e retorna resultado verdadeiro.
  // Passa por validateSignal + risk manager antes de qualquer execução.
  app.post('/api/open', requireActionAuth, async (req, res) => {
    const { asset, direction, entry, tp, sl, leverage, marginType } = req.body ?? {};
    if (!asset || !direction || entry == null || tp == null || sl == null || leverage == null) {
      return res.status(400).json({
        ok: false,
        error: 'Campos obrigatórios: asset, direction, entry, tp, sl, leverage',
      });
    }
    logger.info(`[WEB] Comando: abertura manual ${direction} ${asset}`);
    try {
      const result = await openManualTrade({
        asset,
        direction,
        entry:      Number(entry),
        tp:         Number(tp),
        sl:         Number(sl),
        leverage:   Number(leverage),
        marginType: marginType ?? 'isolated',
      });
      const status = result.success ? 200 : 422;
      res.status(status).json(result);
    } catch (err) {
      logger.error(`[WEB] Falha inesperada em /api/open: ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Atualizar TP e/ou SL de uma posição aberta — síncrono: retorna resultado verdadeiro.
  app.post('/api/tpsl', requireActionAuth, async (req, res) => {
    const { asset, tp, sl } = req.body ?? {};
    if (!asset || (tp == null && sl == null)) {
      return res.status(400).json({
        ok: false,
        error: 'Campos obrigatórios: asset + ao menos um de tp ou sl',
      });
    }
    logger.info(`[WEB] Comando: atualizar TP/SL ${asset}`);
    try {
      const result = await updateManualTpSl(
        asset,
        tp != null ? Number(tp) : null,
        sl != null ? Number(sl) : null,
      );
      const status = result.success ? 200 : 422;
      res.status(status).json(result);
    } catch (err) {
      logger.error(`[WEB] Falha inesperada em /api/tpsl: ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // Reduzir posição parcialmente — síncrono: aguarda execução e retorna resultado verdadeiro.
  // reducePercent: 1–95. Acima de 95% é rejeitado — use /api/close para fechar tudo.
  app.post('/api/reduce', requireActionAuth, async (req, res) => {
    const { asset, reducePercent } = req.body ?? {};
    if (!asset || reducePercent == null) {
      return res.status(400).json({
        ok: false,
        error: 'Campos obrigatórios: asset, reducePercent (1–95)',
      });
    }
    logger.info(`[WEB] Comando: redução parcial ${asset} ${reducePercent}%`);
    try {
      const result = await reduceManualTrade(asset, Number(reducePercent));
      const status = result.success ? 200 : 422;
      res.status(status).json(result);
    } catch (err) {
      logger.error(`[WEB] Falha inesperada em /api/reduce: ${err.message}`);
      res.status(500).json({ ok: false, error: err.message });
    }
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
    // Helper: rejeita comando se socket não autorizado, com log e resposta de erro
    const assertAuth = (event) => {
      if (isSocketAuthorized(socket)) return true;
      logger.warn(`[WEB] ⛔ Comando Socket.IO bloqueado (não autorizado): ${event}`);
      socket.emit('cmd:error', { event, error: 'Não autorizado. Forneça token via handshake auth.token.' });
      return false;
    };

    // Comandos de controle via Socket.IO — todos protegidos por assertAuth
    socket.on('cmd:pause',       ()              => { if (assertAuth('cmd:pause'))       state.setPaused(true); });
    socket.on('cmd:resume',      ()              => { if (assertAuth('cmd:resume'))      state.setPaused(false); });
    socket.on('cmd:autotrading', ({ enabled })   => { if (assertAuth('cmd:autotrading')) state.setAutoTrading(Boolean(enabled)); });
    socket.on('cmd:intake',      ({ enabled } = {}) => { if (assertAuth('cmd:intake')) state.setSignalIntakeEnabled(Boolean(enabled)); });
    socket.on('cmd:close',       ({ asset, venue } = {}) => {
      if (!assertAuth('cmd:close')) return;
      const { venue: resolvedVenue } = resolveCloseVenue(asset, venue, { allowActiveFallback: false });
      state.emit('cmd:close', { asset, venue: resolvedVenue });
    });
    socket.on('cmd:close_all',   ({ venue } = {})        => {
      if (!assertAuth('cmd:close_all')) return;
      const { venue: resolvedVenue } = resolveCloseVenue(null, venue, { allowActiveFallback: false });
      state.emit('cmd:close_all', { venue: resolvedVenue });
    });
    socket.on('cmd:open_manual', (params)        => { if (assertAuth('cmd:open_manual')) state.emit('cmd:open_manual', params); });
    socket.on('cmd:update_tpsl', ({ asset, tp, sl }) => { if (assertAuth('cmd:update_tpsl')) state.emit('cmd:update_tpsl', { asset, tp, sl }); });
    socket.on('cmd:reduce',      ({ asset, reducePercent } = {}) => {
      if (!assertAuth('cmd:reduce')) return;
      state.emit('cmd:reduce', { asset, reducePercent });
    });
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

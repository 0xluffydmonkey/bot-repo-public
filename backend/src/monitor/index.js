// src/monitor/index.js
// Ponto de entrada standalone do monitor.
// Uso: node src/monitor/index.js
// (não precisa do bot Telegram rodando)

import dotenv from 'dotenv';
dotenv.config();

import { startMonitor } from './monitor_service.js';

console.log('⚡ Iniciando monitor... (Ctrl+C para sair)');

startMonitor({ standalone: true }).catch(err => {
  console.error('Erro fatal ao iniciar monitor:', err.message);
  process.exit(1);
});
// src/utils/logger.js
import winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import { config } from '../config/index.js';
import fs from 'fs';

// Garantir que o diretório de logs existe
if (!fs.existsSync(config.log.dir)) {
  fs.mkdirSync(config.log.dir, { recursive: true });
}

const { combine, timestamp, printf, colorize, errors } = winston.format;

const logFormat = printf(({ level, message, timestamp, stack, ...meta }) => {
  const metaStr = Object.keys(meta).length ? `\n  ${JSON.stringify(meta, null, 2)}` : '';
  return `${timestamp} [${level.toUpperCase().padEnd(5)}] ${stack || message}${metaStr}`;
});

const logger = winston.createLogger({
  level: config.log.level,
  format: combine(
    timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    errors({ stack: true }),
    logFormat
  ),
  transports: [
    // Console colorido
    new winston.transports.Console({
      format: combine(
        colorize({ all: true }),
        timestamp({ format: 'DD/MM/YYYY HH:mm:ss' }),
        errors({ stack: true }),
        logFormat
      ),
    }),

    // Arquivo geral rotativo
    new DailyRotateFile({
      filename:    `${config.log.dir}/bot-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      maxFiles:    '14d',
      maxSize:     '20m',
    }),

    // Arquivo separado só para erros
    new DailyRotateFile({
      level:       'error',
      filename:    `${config.log.dir}/errors-%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      maxFiles:    '30d',
    }),
  ],
});

export default logger;

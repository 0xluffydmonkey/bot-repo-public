// src/parser/signal_parser.js
import logger from '../utils/logger.js';

/**
 * Regex patterns para extração dos campos do sinal
 * Suporta emojis, variações de formatação e espaços extras
 */
const PATTERNS = {
  // 🚨 NOVO SINAL | #ETH17032604V13
  SIGNAL_TRIGGER: /🚨\s*NOVO\s*SINAL/i,

  // #ETH17032604V13
  SIGNAL_ID: /#([A-Z0-9]+)/i,

  // Ativo: ETH
  ASSET: /Ativo\s*:\s*([A-Z]{2,10})/i,

  // Direção: 🔴 SHORT  ou  Direção: 🟢 LONG
  DIRECTION_SHORT: /Dire[çc][aã]o\s*:.*(?:🔴|CURTO|SHORT)/i,
  DIRECTION_LONG:  /Dire[çc][aã]o\s*:.*(?:🟢|LONGO|LONG)/i,

  // Entrada: $2,332.58
  ENTRY: /Entrada\s*:\s*\$?([\d,]+\.?\d*)/i,

  // 🎯 TP: $2,181.90 (6.46%)  — captura apenas o número antes do parêntese
  TP: /(?:🎯\s*)?TP\s*:\s*\$?([\d,]+\.?\d*)(?:\s*\([\d.]+%\))?/i,

  // 🛑 SL: $2,407.92 (3.23%)
  SL: /(?:🛑\s*)?SL\s*:\s*\$?([\d,]+\.?\d*)(?:\s*\([\d.]+%\))?/i,

  // ⚡️ Alavancagem máx: 12.4x
  LEVERAGE: /Alavancagem\s*m[aá]x(?:ima)?\s*:\s*([\d.]+)\s*x/i,

  // Margem: ISOLATED | Tipo de Margem: CROSS | Margin Type: ISOLATED
  // Aceita variações PT/EN e valores em inglês/português
  MARGIN_TYPE: /(?:Tipo\s+de\s+)?[Mm]argem(?:\s+[Tt]ype)?\s*:\s*(ISOLATED|CROSS|ISOLADA|CRUZADA)/i,
};

/**
 * Remove formatação de número (vírgulas como separadores de milhar)
 */
function parseNumber(str) {
  if (!str) return null;
  // Remove tudo que não seja dígito ou ponto decimal
  const cleaned = str.replace(/,/g, '').replace(/[^\d.]/g, '');
  const num = parseFloat(cleaned);
  return isNaN(num) ? null : num;
}

/**
 * Faz parsing de uma mensagem do Telegram
 * Retorna objeto com os campos extraídos ou null se não for um sinal válido
 */
export function parseSignal(messageText) {
  if (!messageText || typeof messageText !== 'string') {
    return null;
  }

  // Verificação rápida: contém o trigger?
  if (!PATTERNS.SIGNAL_TRIGGER.test(messageText)) {
    return null;
  }

  logger.debug(`[PARSER] Mensagem trigger detectada, iniciando parsing...`);

  const result = {
    raw:        messageText,
    signalId:   null,
    asset:      null,
    direction:  null,
    entry:      null,
    tp:         null,
    sl:         null,
    leverage:   null,
    marginType: null,
    parsedAt:   new Date().toISOString(),
  };

  // ID do sinal
  const idMatch = messageText.match(PATTERNS.SIGNAL_ID);
  result.signalId = idMatch ? idMatch[1].toUpperCase() : null;

  // Ativo
  const assetMatch = messageText.match(PATTERNS.ASSET);
  result.asset = assetMatch ? assetMatch[1].toUpperCase() : null;

  // Direção
  if (PATTERNS.DIRECTION_SHORT.test(messageText)) {
    result.direction = 'SHORT';
  } else if (PATTERNS.DIRECTION_LONG.test(messageText)) {
    result.direction = 'LONG';
  }

  // Entrada
  const entryMatch = messageText.match(PATTERNS.ENTRY);
  result.entry = entryMatch ? parseNumber(entryMatch[1]) : null;

  // Take Profit
  const tpMatch = messageText.match(PATTERNS.TP);
  result.tp = tpMatch ? parseNumber(tpMatch[1]) : null;

  // Stop Loss
  const slMatch = messageText.match(PATTERNS.SL);
  result.sl = slMatch ? parseNumber(slMatch[1]) : null;

  // Alavancagem
  const levMatch = messageText.match(PATTERNS.LEVERAGE);
  result.leverage = levMatch ? parseFloat(levMatch[1]) : null;

  // Tipo de margem — se ausente, aplica padrão seguro: 'isolated'
  const marginMatch = messageText.match(PATTERNS.MARGIN_TYPE);
  if (marginMatch) {
    const raw = marginMatch[1].toUpperCase();
    result.marginType = (raw === 'CROSS' || raw === 'CRUZADA') ? 'cross' : 'isolated';
    logger.info(`[PARSER] Tipo de margem encontrado no sinal: ${result.marginType}`);
  } else {
    result.marginType = 'isolated'; // padrão seguro: nunca abrir como cross por omissão
    logger.warn(`[PARSER] Tipo de margem ausente no sinal — aplicando padrão seguro: isolated`);
  }

  logger.debug(`[PARSER] Resultado bruto:`, {
    signalId:   result.signalId,
    asset:      result.asset,
    direction:  result.direction,
    entry:      result.entry,
    tp:         result.tp,
    sl:         result.sl,
    leverage:   result.leverage,
    marginType: result.marginType,
  });

  return result;
}

/**
 * Valida se o sinal parseado está completo e logicamente correto
 * Retorna { valid: bool, errors: string[] }
 */
export function validateSignal(signal) {
  const errors = [];

  if (!signal) {
    return { valid: false, errors: ['Sinal nulo'] };
  }

  // Campos obrigatórios
  if (!signal.signalId) errors.push('ID do sinal ausente');
  if (!signal.asset)    errors.push('Ativo ausente');
  if (!signal.direction) errors.push('Direção ausente (LONG/SHORT)');
  if (!signal.entry || signal.entry <= 0) errors.push('Entrada ausente ou inválida (deve ser > 0)');
  if (signal.tp      === null) errors.push('Take Profit ausente');
  if (signal.sl      === null) errors.push('Stop Loss ausente');
  if (signal.leverage === null) errors.push('Alavancagem ausente');

  // marginType deve ser explícito e válido (parseSignal já aplica default 'isolated')
  if (!signal.marginType) {
    errors.push('Tipo de margem ausente (isolated/cross)');
  } else if (signal.marginType !== 'isolated' && signal.marginType !== 'cross') {
    errors.push(`Tipo de margem inválido: "${signal.marginType}" — use "isolated" ou "cross"`);
  }

  // Se campos básicos estão OK, validar lógica de preços
  if (errors.length === 0) {
    if (signal.direction === 'LONG') {
      if (signal.tp <= signal.entry) {
        errors.push(`LONG inválido: TP (${signal.tp}) deve ser > Entrada (${signal.entry})`);
      }
      if (signal.sl >= signal.entry) {
        errors.push(`LONG inválido: SL (${signal.sl}) deve ser < Entrada (${signal.entry})`);
      }
    }

    if (signal.direction === 'SHORT') {
      if (signal.tp >= signal.entry) {
        errors.push(`SHORT inválido: TP (${signal.tp}) deve ser < Entrada (${signal.entry})`);
      }
      if (signal.sl <= signal.entry) {
        errors.push(`SHORT inválido: SL (${signal.sl}) deve ser > Entrada (${signal.entry})`);
      }
    }

    if (signal.leverage <= 0) {
      errors.push(`Alavancagem inválida: ${signal.leverage}`);
    }

    if (signal.entry <= 0) {
      errors.push(`Entrada inválida: ${signal.entry}`);
    }
  }

  const valid = errors.length === 0;

  if (valid) {
    logger.info(`[PARSER] ✅ Sinal ${signal.signalId} validado com sucesso`);
  } else {
    logger.warn(`[PARSER] ❌ Sinal inválido:`, { errors });
  }

  return { valid, errors };
}

// src/trading/valiantAutoTransfer.js
//
// Auto-transfer USDC from the Hyperliquid spot wallet to the perps margin account.
// Gated by ENABLE_VALIANT_AUTO_MARGIN_TRANSFER=true in .env.
//
// This file is intentionally Hyperliquid-specific and imports directly from
// hyperliquidClient.js.  It is NOT part of the venue-agnostic adapter layer.
//
// Called from executeSignal() (ManualTradeService.js) when:
//   - venue is 'valiant'
//   - ENABLE_VALIANT_AUTO_MARGIN_TRANSFER=true
//   - perps freeCollateral is zero
//   - not in paper mode
//
// Design contract:
//   - Called AFTER risk manager approval — never before; no funds move pre-approval
//   - Exact amount: transfers only the shortfall needed for the approved trade (+2% buffer)
//   - Idempotent: re-fetches live perps state before acting; no-ops if already sufficiently funded
//   - Fail closed: any error throws — order is never attempted after a failed transfer
//   - No silent fund movement: logs spot balance, transfer amount, and post-transfer state
//   - In-flight guard: a second concurrent call throws immediately

import logger from '../utils/logger.js';
import {
  getAccountSnapshot,
  getSpotBalance,
  transferSpotToPerps,
} from './clients/hyperliquidClient.js';

// Re-exported for diagnostic use in executeSignal() — read-only, no fund movement.
export { getSpotBalance as getValiantSpotUSDC };

// ── In-flight guard ─────────────────────────────────────────────────────────────
// Node.js is single-threaded; a boolean is sufficient to detect re-entrant calls
// across async boundaries within the same process lifecycle.
let _transferInFlight = false;

/**
 * Ensure Hyperliquid perps margin is available for a specific trade amount.
 *
 * If perps freeCollateral >= transferAmount already → returns immediately (no transfer).
 * If freeCollateral < transferAmount → transfers exactly `transferAmount` from spot to perps,
 *   re-fetches perps state, verifies funding (within 1% tolerance), returns new freeCollateral.
 *
 * Called by ManualTradeService AFTER risk manager approval — never before.
 * transferAmount is the exact shortfall computed from the approved positionSizeUSD:
 *   max(0, positionSizeUSD / (1 - MIN_FREE_MARGIN_PCT) - existingPerps) * 1.02
 *
 * @param {number} transferAmount — exact USD to transfer (positive); computed post-risk-approval
 * @param {string} signalId       — for log correlation
 * @returns {Promise<number>} perps freeCollateral after transfer (or existing balance if sufficient)
 * @throws if spot is insufficient, transfer API fails, or post-transfer state is still below needed
 */
export async function ensureValiantPerpsMargin(transferAmount, signalId) {
  // ── Idempotency: live re-check before acting ─────────────────────────────────
  // Handles retries and concurrent paths — never transfer if already funded.
  const snapBefore = await getAccountSnapshot();
  if (snapBefore.freeCollateral >= transferAmount) {
    logger.info('[AUTOTRANSFER] Perps já tem margem suficiente — sem transferência necessária', {
      signalId,
      freeCollateral: snapBefore.freeCollateral.toFixed(2),
      required:       transferAmount.toFixed(2),
    });
    return snapBefore.freeCollateral;
  }

  // ── In-flight guard ──────────────────────────────────────────────────────────
  if (_transferInFlight) {
    throw new Error(
      '[AUTOTRANSFER] Outra transferência já está em andamento — ' +
      'aguarde a conclusão da execução atual antes de tentar novamente.'
    );
  }
  _transferInFlight = true;

  try {
    // ── Check spot balance ────────────────────────────────────────────────────
    const spotBalance = await getSpotBalance();

    logger.info('[AUTOTRANSFER] Estado pré-transferência', {
      signalId,
      perpsFreeCollateral: snapBefore.freeCollateral.toFixed(2),
      spotUSDC:            spotBalance.toFixed(2),
      required:            transferAmount.toFixed(2),
    });

    if (spotBalance < transferAmount) {
      throw new Error(
        `[AUTOTRANSFER] Spot USDC insuficiente para a transferência necessária. ` +
        `Necessário: $${transferAmount.toFixed(2)}, disponível: $${spotBalance.toFixed(2)}. ` +
        'Deposite mais USDC no Hyperliquid antes de operar.'
      );
    }

    // ── Transfer exact required amount to perps ──────────────────────────────
    // transferAmount is the minimum needed for the approved trade (post-risk-approval),
    // computed by ManualTradeService as:
    //   max(0, positionSizeUSD / (1 - MIN_FREE_MARGIN_PCT) - existingPerps) * 1.02
    // The 1.02 factor provides a 2% buffer for rounding and minor API lag.
    const toTransfer = parseFloat(transferAmount.toFixed(2));

    logger.warn('[AUTOTRANSFER] ⚠️  Transferindo USDC spot → perps', {
      signalId,
      transferAmount: toTransfer.toFixed(2),
      note: 'Fundos movidos internamente na conta Hyperliquid (reversível manualmente via UI)',
    });

    await transferSpotToPerps(toTransfer);

    // ── Re-fetch perps state to confirm margin is available ───────────────────
    const snapAfter = await getAccountSnapshot();

    logger.info('[AUTOTRANSFER] Estado pós-transferência', {
      signalId,
      freeCollateral: snapAfter.freeCollateral.toFixed(2),
      totalEquity:    snapAfter.totalEquity.toFixed(2),
    });

    // Allow 1% tolerance for rounding and minor API lag
    if (snapAfter.freeCollateral < transferAmount * 0.99) {
      throw new Error(
        `[AUTOTRANSFER] Transferência enviada mas freeCollateral perps ($${snapAfter.freeCollateral.toFixed(2)}) ` +
        `ainda abaixo do necessário ($${transferAmount.toFixed(2)}) — ` +
        'estado inconsistente. Abortando por segurança. Verifique o saldo manualmente.'
      );
    }

    return snapAfter.freeCollateral;

  } finally {
    _transferInFlight = false;
  }
}

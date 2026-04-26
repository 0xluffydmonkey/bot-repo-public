-- Migration: enforce at most one OPEN trade per (symbol, venue, mode)
--
-- Problema que resolve:
--   Múltiplos registros com status='OPEN' para o mesmo (symbol, venue, mode)
--   causam adopt_skip_ambiguous no reconciliador e fallback heurístico no close.
--
-- ATENÇÃO: execute os passos em ordem. Não aplique o índice antes de verificar
-- e corrigir violações existentes.
--
-- ─── Passo 1 ─ Verificar violações ──────────────────────────────────────────
--
-- SELECT symbol, venue, mode, COUNT(*) AS cnt,
--        array_agg(id ORDER BY opened_at DESC) AS ids,
--        array_agg(bot_trade_ref ORDER BY opened_at DESC) AS refs
-- FROM trades
-- WHERE status = 'OPEN'
-- GROUP BY symbol, venue, mode
-- HAVING COUNT(*) > 1;
--
-- Se a query retornar linhas, corrija-as no Passo 2 antes de continuar.
--
-- ─── Passo 2 ─ Fechar duplicatas mais antigas (manter apenas a mais recente) ─
--
-- Para cada grupo ambíguo retornado acima, feche os registros mais antigos
-- (todos os ids EXCETO o primeiro da lista ids[], que é o mais recente).
-- Exemplo para fechar manualmente por id:
--
-- UPDATE trades
-- SET    status = 'CLOSED', closed_at = NOW()
-- WHERE  id IN ('<uuid_antigo_1>', '<uuid_antigo_2>')
--   AND  closed_at IS NULL;
--
-- Repita para cada grupo. Confirme que a query do Passo 1 agora retorna 0 linhas.
--
-- ─── Passo 3 ─ Criar o índice único parcial ──────────────────────────────────
--
-- O índice cobre apenas linhas com status='OPEN', portanto trades CLOSED não são
-- afetados e o mesmo (symbol, venue, mode) pode ter múltiplos registros fechados.

CREATE UNIQUE INDEX IF NOT EXISTS idx_trades_one_open_per_symbol_venue_mode
  ON trades (symbol, venue, mode)
  WHERE (status = 'OPEN');

-- ─── Verificação pós-aplicação ───────────────────────────────────────────────
--
-- SELECT indexname, indexdef
-- FROM   pg_indexes
-- WHERE  tablename = 'trades'
--   AND  indexname = 'idx_trades_one_open_per_symbol_venue_mode';

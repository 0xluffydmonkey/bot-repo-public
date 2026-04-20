# Modo Paper

O modo paper é o ambiente de simulação seguro do bot. É o **modo padrão** e deve ser usado por pelo menos 24 horas antes de qualquer implantação live.

---

## Como ativar

Em `backend/.env`:

```env
PAPER_TRADING=true
```

Esta é uma configuração de inicialização. O modo paper vs operação ao vivo não pode ser alterado em tempo de execução.

---

## O que o modo paper faz

O bot executa o pipeline completo de processamento de sinais — listener do Telegram, parser de sinais, deduplicação, risk manager — com uma diferença: em vez de chamar o adaptador blockchain real, todas as chamadas de execução são interceptadas pelo **paper engine**.

O paper engine:
- mantém uma carteira paper em memória com saldo simulado (padrão: `$10.000`, configurável via `PAPER_INITIAL_BALANCE`)
- rastreia posições abertas em memória
- simula abertura, fechamento, redução parcial e atualização de TP/SL
- calcula mark prices com uma pequena oscilação sinusoidal para feedback visual
- é resetado ao reiniciar o processo

### O que o modo paper valida (igual ao live)

- Formato e campos do sinal
- Suporte ao ativo no venue ativo
- Cap de alavancagem
- Relação mínima R:R
- Colateral livre (do saldo do paper engine)
- Máximo de posições
- Máxima exposição
- Step size e quantidade mínima de base

### O que o modo paper NÃO valida

- Sucesso de transações/ordens live
- Liquidez real de mercado ou slippage
- Estado real do order book ou liquidez do backend selecionado
- Disponibilidade de taxas/gas do backend selecionado

---

## Saldo do paper engine

O saldo inicial é `$10.000` por padrão. Para alterar:

```env
PAPER_INITIAL_BALANCE=5000
```

O saldo diminui conforme posições são abertas (o colateral é consumido) e aumenta quando posições fecham (colateral + PnL realizado é devolvido).

O saldo no painel reflete o estado real do paper engine — não são dados estáticos simulados.

---

## Superfícies do operador em modo paper

Todas as superfícies do operador funcionam de forma idêntica em modo paper e live:
- o painel mostra posições e PnL reais do paper engine
- o Telegram mostra cards de posição com rótulo `🧪 PAPER`
- abertura manual, fechamento, redução e TP/SL funcionam normalmente
- controles operacionais (pause, intake, autotrading) funcionam normalmente

O rótulo `🧪 PAPER` aparece em cards de abertura, alertas de fechamento, alertas de PnL, confirmações de trade manual e alertas de lucro. Impossível confundir com operação real no Telegram.

---

## Modo paper vs modo ao vivo — resumo de comportamento

| Comportamento | Paper | Live |
|--------------|-------|------|
| Intake e parse de sinais | Pipeline completo | Pipeline completo |
| Validação do risk manager | Todas as camadas | Todas as camadas |
| Transações live | Simulado em memória | Ordens reais no backend |
| Rastreamento de saldo | Paper engine (memória) | Conta live do backend |
| Rastreamento de posições | Paper engine | Estado live do backend |
| Painel mostra dados reais | Sim | Sim |
| Alertas de posição no Telegram | Sim, com rótulo 🧪 | Sim |
| Trading manual | Sim | Sim |
| Atualização de TP/SL | Sim (simulado) | Ordem no backend quando suportado |
| Redução parcial | Sim (simulado) | Ordem no backend quando suportado |
| Conexão live com backend necessária | Não | Sim |
| Estado persiste após reinício | Não — é resetado | Backend é a fonte da verdade |

---

## Venue em modo paper

O modo paper é venue-agnóstico. O paper engine intercepta todas as chamadas de execução independentemente do venue configurado via `PERP_OPEN_VENUE`.

No entanto, o bot ainda usa metadados do venue (ativos suportados, limites de alavancagem, step sizes) para validação de risco. Isso ajuda o paper mode a detectar problemas de configuração e sizing antes do live.

---

## Reconciliação em modo paper

O serviço de reconciliação exclui trades paper de todas as passagens. Posições paper são gerenciadas inteiramente pelo paper engine em memória e nunca são enviadas para a lógica de reconciliação do banco.

---

## Quando ir para o live

Antes de mudar `PAPER_TRADING=false`:

- [ ] Bot rodou por 24h+ sem erros em modo paper
- [ ] Detecção de sinais funcionando (sinais aparecem no log)
- [ ] Posições abrindo, sendo rastreadas e fechando corretamente em modo paper
- [ ] Cards de posição no Telegram aparecendo corretamente
- [ ] Controles operacionais funcionando conforme esperado
- [ ] Parâmetros de risco ajustados conforme seu nível de conforto
- [ ] Conta live com colateral e ativo de taxas/gas exigidos pelo backend selecionado
- [ ] `POSITION_SIZE_PCT` configurado de forma conservadora (recomendado: `0.01` = 1%)

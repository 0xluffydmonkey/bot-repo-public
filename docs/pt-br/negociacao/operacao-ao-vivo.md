# Operação ao Vivo

## Propósito

Documentar os cuidados para operar com dinheiro real usando a implementação atual.

## Público-alvo

Operadores autorizados a executar operação ao vivo.

## Pré-requisitos

- `PAPER_TRADING=false`
- Venue live-ready: hoje `drift` ou `valiant`
- Segredos externos configurados
- Wallet/key via arquivo externo
- Preflight manual e teste live pequeno concluídos

## Onde se encaixa

O operação ao vivo usa `PerpExecutionService` para rotear para o adaptador da venue ativa. O risk manager roda antes da execução e aplica limites: `POSITION_SIZE_PCT`, `MAX_LEVERAGE`, `MAX_POSITIONS`, `MIN_FREE_MARGIN_PCT`, `MAX_TOTAL_EXPOSURE_PCT`.

## Configuração Base

Em `backend/.env`:

```env
PAPER_TRADING=false
PERP_OPEN_VENUE=drift
POSITION_SIZE_PCT=0.01
MAX_LEVERAGE=5
MAX_POSITIONS=1
MIN_FREE_MARGIN_PCT=0.10
MAX_TOTAL_EXPOSURE_PCT=0.30
MAX_SLIPPAGE_BPS=100
```

Para Drift/Solana, em `/opt/bot/secrets/bot-secrets.env`:

```env
SOLANA_RPC_URL=https://provedor-rpc.example
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
```

Para Valiant/Hyperliquid:

```env
VALIANT_BASE_URL=https://api.hyperliquid.xyz
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_ACCOUNT_ADDRESS=0xEnderecoPublico
ENABLE_AUTO_TRADING_VALIANT=false
```

Se `ENABLE_VALIANT_AUTO_MARGIN_TRANSFER=true`, também é obrigatório:

```env
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
```

## Passo a Passo Seguro

1. Rodar paper por pelo menos um ciclo operacional relevante.
2. Confirmar logs, Telegram, painel e closes.
3. Configurar live com `POSITION_SIZE_PCT` baixo.
4. Confirmar venue live-ready.
5. Rodar boot e conferir fail-fast sem warnings críticos.
6. Abrir um trade manual mínimo.
7. Fechar o trade manual e validar saldo/estado.
8. Somente depois considerar auto-trading.

## Gates de Auto-Trading

Existe gate global em runtime: painel/bot de controle alternam `state.status.autoTrading`.

Valiant também tem gate específico:

```env
ENABLE_AUTO_TRADING_VALIANT=false
```

Enquanto esse flag não for `true`, sinais automáticos para Valiant são bloqueados mesmo que auto-trading global esteja ligado.

## TP/SL em Valiant/Hyperliquid

TP/SL usa trigger orders nativas com `triggerPx`, preço limite agressivo válido `p`, `grouping: "positionTpsl"` e campos numéricos normalizados em wire format antes da assinatura. Sempre verifique se as trigger orders foram aceitas pela venue após abrir uma posição. Veja [politica-de-fechamento.md](politica-de-fechamento.md).

## Retry no ajuste de alavancagem (Valiant/Hyperliquid)

Ao abrir uma posição, o bot define a alavancagem em modo isolated antes de enviar a ordem. Essa é uma chamada separada e pode falhar de forma transitória com a rejeição `Invalid leverage value` (HTTP 200, status `err`) mesmo quando o valor da alavancagem é válido — instabilidade conhecida da venue.

O adaptador faz retry **somente no passo de set leverage**, até 2 tentativas adicionais (3 no total), com 500 ms de intervalo entre cada. O envio da ordem nunca entra em retry e só é executado após o set leverage ser confirmado.

**Classificação de erros:**

| Padrão de erro | Comportamento |
|----------------|---------------|
| `Invalid leverage value` e erros genéricos de exchange | Retry até 2 vezes |
| Erros de assinatura/autenticação (`agent`, `auth`, `sign`, `unauthorized`, `Must deposit`) | Falha imediata — não mascarada por retry |

**Garantias:**
- Duplicação de ordem por retry de leverage é impossível — `placeOrder` é chamado apenas uma vez.
- Erros estruturais de assinatura aparecem imediatamente e não são encobertos pelo retry.
- Se as 3 tentativas de leverage falharem, a abertura é abortada antes de qualquer ordem ser enviada.

**Eventos de log do retry de leverage:**

| Evento | Nível | Quando |
|--------|-------|--------|
| `leverage_set_retry_attempt` | WARN | Cada tentativa de retry; inclui `attempt` (base 1) e mensagem de erro |
| `leverage_set_retry_success` | INFO | Leverage aceita em uma tentativa de retry |
| `leverage_set_retry_failed_final` | ERROR | Todas as tentativas esgotadas; inclui total de `attempts` |
| `leverage_set_no_retry_unmapped_error` | ERROR | Erro não retryable — falha imediata |

Para filtrar esses eventos:

```bash
journalctl -u bot-trader -f | grep 'leverage_set_retry'
```

## Reconciliação em Modo Live

Em modo ao vivo, a reconciliação é bidirecional:

- trades `OPEN` no banco que não existem mais na venue ativa são reconciliados para `CLOSED`.
- posições live encontradas na venue ativa sem trade `OPEN` correspondente no banco podem ser adotadas como novos trades `OPEN` persistidos.

A adoção é conservadora. A posição precisa aparecer em 2 ciclos consecutivos de reconciliação, ter direção `LONG`/`SHORT` confiável e não ter trade `OPEN` existente para o mesmo `venue + asset` ativo. O trade adotado usa `open_source='venue_reconciliation'`, recebe `bot_trade_ref`, aparece no banco como `OPEN` e passa a participar de tracking, alertas, trailing stops, closes manuais/trailing e closes externos reconciliados.

Para Valiant/Hyperliquid, registros de trades fechados também podem ser enriquecidos com `exit_price` e `realized_pnl` do histórico de fills. A reconciliação hoje considera apenas a venue ativa por ciclo, então não trate operação multi-venue simultânea como plenamente resolvida. Veja [../operacoes/reconciliacao.md](../operacoes/reconciliacao.md).

## Riscos

- Crítico: private key em `.env`.
- Crítico: operar live com wallet/key errada.
- Alto: habilitar auto-trading sem teste manual de close.
- Alto: Valiant auto-transfer usando agent key em vez da main key.
- Médio: persistência externa indisponível reduz auditoria.
- Médio: posições manuais na venue podem ser adotadas com atraso, ou não ser adotadas se abertas e fechadas antes de duas confirmações de reconciliação.

## Resolução de Problemas

- Live não inicia: confira `validateEnv` e caminhos obrigatórios.
- Venue não pronta: veja [venues.md](venues.md).
- Sinal ignorado: confira pause, intake, auto-trading global e gate da venue.
- Falha de saldo: confira free collateral, spot/perps e limites do risk manager.

## Lista de Verificação Final

- [ ] `PAPER_TRADING=false` foi decisão consciente
- [ ] Wallet/key fica fora do repo
- [ ] Primeiro teste live foi manual e pequeno
- [ ] Close manual foi validado
- [ ] Gate de auto-trading específico da venue só habilitado após validação

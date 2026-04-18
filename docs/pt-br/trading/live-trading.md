# Live Trading

## Propósito

Documentar os cuidados para operar com dinheiro real usando a implementação atual.

## Público-alvo

Operadores autorizados a executar live trading.

## Pré-requisitos

- `PAPER_TRADING=false`
- Venue live-ready: hoje `drift` ou `valiant`
- Secrets externos configurados
- Wallet/key via arquivo externo
- Preflight manual e teste live pequeno concluídos

## Onde se encaixa

O live trading usa `PerpExecutionService` para rotear para o adapter da venue ativa. O risk manager roda antes da execução e aplica limites: `POSITION_SIZE_PCT`, `MAX_LEVERAGE`, `MAX_POSITIONS`, `MIN_FREE_MARGIN_PCT`, `MAX_TOTAL_EXPOSURE_PCT`.

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
2. Confirmar logs, Telegram, dashboard e closes.
3. Configurar live com `POSITION_SIZE_PCT` baixo.
4. Confirmar venue live-ready.
5. Rodar boot e conferir fail-fast sem warnings críticos.
6. Abrir um trade manual mínimo.
7. Fechar o trade manual e validar saldo/estado.
8. Somente depois considerar auto-trading.

## Gates de Auto-Trading

Existe gate global em runtime: dashboard/control bot alternam `state.status.autoTrading`.

Valiant também tem gate específico:

```env
ENABLE_AUTO_TRADING_VALIANT=false
```

Enquanto esse flag não for `true`, sinais automáticos para Valiant são bloqueados mesmo que auto-trading global esteja ligado.

## TP/SL em Valiant/Hyperliquid

TP/SL usa trigger orders nativas com `triggerPx`, preço limite agressivo válido `p`, `grouping: "positionTpsl"` e campos numéricos normalizados em wire format antes da assinatura. Sempre verifique se as trigger orders foram aceitas pela venue após abrir uma posição. Veja [close-policy.md](close-policy.md).

## Reconciliação em Modo Live

Em modo live, o serviço de reconciliação detecta automaticamente posições fechadas externamente (liquidações, UI da venue, TP/SL hits na exchange, reinício do bot durante um close) e atualiza o banco. Para Valiant/Hyperliquid, ele também enriquece o registro do trade fechado com `exit_price` e `realized_pnl` do histórico de fills. Veja [../operations/reconciliation.md](../operations/reconciliation.md).

## Riscos

- Crítico: private key em `.env`.
- Crítico: operar live com wallet/key errada.
- Alto: habilitar auto-trading sem teste manual de close.
- Alto: Valiant auto-transfer usando agent key em vez da main key.
- Médio: persistência externa indisponível reduz auditoria.

## Troubleshooting

- Live não inicia: confira `validateEnv` e paths obrigatórios.
- Venue não pronta: veja [venues.md](venues.md).
- Sinal ignorado: confira pause, intake, auto-trading global e gate da venue.
- Falha de saldo: confira free collateral, spot/perps e limites do risk manager.

## Checklist Final

- [ ] `PAPER_TRADING=false` foi decisão consciente
- [ ] Wallet/key fica fora do repo
- [ ] Primeiro teste live foi manual e pequeno
- [ ] Close manual foi validado
- [ ] Gate de auto-trading específico da venue só habilitado após validação

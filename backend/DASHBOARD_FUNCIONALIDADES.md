# Dashboard do Bot de Trade

> **English version:** see [docs/en/operator-guide.md](../docs/en/operator-guide.md)

Este painel foi feito para que qualquer operador consiga acompanhar e controlar o bot de trade de forma visual, sem precisar entender código.

---

## O que o dashboard mostra

### 1. Status operacional

Na parte principal da tela, o dashboard mostra:

- se o bot está ativo, pausado ou parado
- se o auto-trading está ligado ou desligado
- se o intake de sinais está ativo ou desativado
- o venue ativo (ex: `DRIFT`, `JUPITER`)
- o modo de operação (PAPER ou LIVE)
- uptime desde o último início

### 2. Posições abertas

Para cada posição aberta:

- ativo negociado (`SOL`, `ETH`, etc.)
- direção (`LONG` ou `SHORT`)
- alavancagem
- preço de entrada
- preço atual (mark price)
- PnL atual (valor e %)
- colateral e nocional
- TP e SL configurados

### 3. Conta e saldo

- equity total
- colateral livre
- margem usada
- PnL não realizado
- PnL da sessão

### 4. Log de sinais

- sinais recebidos, executados e ignorados
- motivo de cada sinal ignorado (pausa, auto-trading OFF, intake OFF, risk manager)

### 5. Log de erros

- erros recentes com contexto

---

## O que pode ser controlado pelo dashboard

### Controles básicos

| Ação | Como |
|------|------|
| Pausar execução | Botão **Pause** |
| Retomar execução | Botão **Resume** |
| Ligar/desligar auto-trading | Toggle **Auto-trading** |

### Controles via API REST

O dashboard também expõe uma API REST para controle completo. Todos os endpoints de escrita requerem o header `X-API-Token` se `WEB_API_TOKEN` estiver configurado.

```
GET  /api/state                              → snapshot completo
POST /api/pause                              → pausar
POST /api/resume                             → retomar
POST /api/autotrading   { enabled: bool }    → auto-trading
POST /api/intake        { enabled: bool }    → intake de sinais
POST /api/close         { asset, venue? }    → fechar posição
POST /api/close_all     { venue? }           → fechar tudo
POST /api/open          { asset, direction, entry, tp, sl, leverage, marginType? }
POST /api/tpsl          { asset, tp?, sl? }
POST /api/reduce        { asset, reducePercent }
```

---

## Controles operacionais

### Pausar o bot

Ao pausar, o bot continua online mas deixa de executar novos sinais. Os sinais recebidos são registrados como ignorados com motivo `bot_paused`. Posições abertas não são afetadas.

Para retomar, use o botão **Resume** ou `POST /api/resume`.

### Auto-trading OFF

Com auto-trading desativado, o bot monitora os sinais sem executar novas ordens. Os sinais aparecem no log como `autotrading_disabled`. Útil para modo observação.

### Intake de sinais OFF

Com intake desativado, todos os sinais recebidos são descartados silenciosamente antes de qualquer processamento — não aparecem no log de ignorados. Use quando quiser parar completamente a entrada de novos sinais.

### Ordem dos filtros

```
Sinal recebido
  │
  ▼ Intake ativo?         NÃO → descarte silencioso
  ▼ Pausado?              SIM → ignorado (bot_paused)
  ▼ Auto-trading ativo?   NÃO → ignorado (autotrading_disabled)
  ▼ executeSignal()
```

---

## Trading manual

### Abrir uma posição manual

Via API REST:
```bash
curl -X POST http://localhost:3000/api/open \
  -H "Content-Type: application/json" \
  -H "X-API-Token: SEU_TOKEN" \
  -d '{"asset":"SOL","direction":"LONG","entry":150,"tp":165,"sl":145,"leverage":5}'
```

A abertura manual passa pelo mesmo risk manager dos sinais automáticos.

### Fechar uma posição

Via API REST:
```bash
curl -X POST http://localhost:3000/api/close \
  -H "Content-Type: application/json" \
  -H "X-API-Token: SEU_TOKEN" \
  -d '{"asset":"SOL"}'
```

### Fechar todas as posições

```bash
curl -X POST http://localhost:3000/api/close_all \
  -H "X-API-Token: SEU_TOKEN"
```

### Atualizar TP ou SL

```bash
curl -X POST http://localhost:3000/api/tpsl \
  -H "Content-Type: application/json" \
  -H "X-API-Token: SEU_TOKEN" \
  -d '{"asset":"SOL","tp":170}'
```

### Redução parcial de posição (1–95%)

```bash
curl -X POST http://localhost:3000/api/reduce \
  -H "Content-Type: application/json" \
  -H "X-API-Token: SEU_TOKEN" \
  -d '{"asset":"SOL","reducePercent":25}'
```

---

## Modo paper

Em modo paper, o dashboard mostra posições e PnL reais do paper engine — não são dados estáticos. Todas as operações funcionam normalmente.

O saldo inicial em paper é `$10.000` por padrão (configurável via `PAPER_INITIAL_BALANCE`).

---

## Atualização em tempo real

O dashboard atualiza automaticamente via WebSocket (Socket.IO). Se a conexão cair, ele reconecta e exibe o estado mais recente.

---

## O que o dashboard não faz sozinho

O dashboard é a interface. O backend é o motor.

- O dashboard mostra e envia comandos
- O backend valida, decide e executa

Para controle via Telegram em vez do dashboard, veja o [Guia do Operador](../docs/pt-BR/guia-do-operador.md).

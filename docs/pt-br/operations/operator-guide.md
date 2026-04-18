# Guia do Operador

Este guia cobre tudo que um operador precisa para rodar o bot com segurança em produção:
- superfícies de controle
- como usar o dashboard
- como usar o bot de controle Telegram
- como executar trades manuais e gerenciar posições
- como usar os controles operacionais (pause, intake, autotrading)

---

## Superfícies de Controle

O bot tem duas superfícies de controle. Ambas leem e escrevem no mesmo estado compartilhado do backend — são equivalentes:

| Superfície | Como acessar | Requer |
|-----------|-------------|--------|
| Dashboard web | `http://localhost:3000` (ou IP do servidor + porta) | `ENABLE_WEB=true` no `.env` |
| Bot de controle Telegram | App do Telegram — qualquer dispositivo | `ENABLE_CONTROL_BOT=true` + token + ID autorizado |

Ambas as superfícies atualizam em tempo real.

---

## Dashboard

### O que mostra

- **Painel de status** — estado do bot, pausa, auto-trading, intake de sinais, modo (paper/live), venue ativa, uptime
- **Painel de posições** — todas as posições abertas com ativo, direção, alavancagem, preço de entrada, preço atual, PnL, TP/SL
- **Painel de conta** — equity total, colateral livre, margem usada, PnL não realizado, PnL da sessão
- **Log de sinais** — sinais recebidos, executados, ignorados (com motivos)
- **Log de erros** — erros recentes com contexto

### O que você pode controlar

| Ação | Como |
|------|------|
| Pausar execução de sinais | Botão **Pause** |
| Retomar execução | Botão **Resume** |
| Ligar/desligar auto-trading | Toggle **Auto-trading** |
| Ligar/desligar intake de sinais | `POST /api/intake` com `{ "enabled": false }` |
| Fechar uma posição | Botão **Close** ao lado da posição |
| Fechar todas as posições | Botão **Close All** — requer confirmação |
| Abrir posição manual | `POST /api/open` com os parâmetros |
| Atualizar TP/SL | `POST /api/tpsl` |
| Reduzir parcialmente | `POST /api/reduce` |

### Referência da API REST

Todos os endpoints de escrita requerem autenticação. Defina `WEB_API_TOKEN` no arquivo de secrets para proteger o acesso remoto. Sem ele, apenas conexões de localhost são permitidas.

Arquivo: `/opt/bot/secrets/bot-secrets.env`

Passe o token como header: `X-API-Token: <seu-token>`

```
GET  /api/state                              → snapshot completo do estado

POST /api/pause                              → pausar execução de sinais
POST /api/resume                             → retomar execução
POST /api/autotrading   { enabled: bool }    → ligar/desligar auto-trading
POST /api/intake        { enabled: bool }    → ligar/desligar intake de sinais

POST /api/close         { asset, venue? }    → fechar posição individual
POST /api/close_all     { venue? }           → fechar todas as posições

POST /api/open          { asset, direction, entry, tp, sl, leverage, marginType? }
POST /api/tpsl          { asset, tp?, sl? }
POST /api/reduce        { asset, reducePercent }   → 1–95% apenas
```

---

## Bot de Controle Telegram

### Configuração

1. Crie um bot via `@BotFather` → `/newbot`
2. Adicione ao arquivo de secrets:

   Arquivo: `/opt/bot/secrets/bot-secrets.env`

   ```env
   TELEGRAM_BOT_TOKEN=123456789:ABCdef...
   TELEGRAM_CONTROL_ALLOWED_IDS=123456789   # seu ID de usuário Telegram
   ```
3. Ative no `.env`:

   ```env
   ENABLE_CONTROL_BOT=true
   ```
4. Reinicie o bot. Envie uma mensagem para o bot no Telegram — ele deve responder.

> Para obter seu ID de usuário: envie qualquer mensagem para `@userinfobot`.

### Navegação

Envie `/menu` ou `/start` para abrir o menu principal. Todas as superfícies de controle são acessíveis por botões de teclado inline.

### Menu principal

Do menu principal você acessa:
- **📡 Status** — status detalhado do bot
- **📊 Posições** — lista de posições abertas
- **💰 Saldo** — saldo da conta
- **📈 P&L** — PnL ao vivo por posição
- **📩 Sinais** — histórico de sinais
- **⚙️ Config** — controles operacionais
- **📝 Trade Manual** — abrir uma posição manualmente

Botões de ação rápida também aparecem diretamente no menu:
- **⏸️ Pausar / ▶️ Retomar** — pausar ou retomar (pausa requer confirmação)
- **🔇 AT: ON→OFF / 🔊 AT: OFF→ON** — ligar/desligar auto-trading (desativar requer confirmação)
- **⚠️ Fechar Tudo** — fechar todas as posições (requer confirmação)

### Comandos

| Comando | Descrição |
|---------|-----------|
| `/menu` | Abrir o menu de controle principal |
| `/start` | Igual ao `/menu` |
| `/status` | Resumo rápido do status |
| `/positions` | Listar posições abertas |
| `/balance` | Saldo da conta |
| `/pnl` | PnL por posição |
| `/signals` | Histórico de sinais |
| `/config` | Configuração operacional |
| `/errors` | Log de erros recentes |

### Tela de configuração

Acesse via **⚙️ Config** no menu principal ou `/config`.

Mostra:
- Modo (paper / live) — somente leitura em tempo de execução
- Venue — somente leitura em tempo de execução
- Auto-trading (ON/OFF)
- Status do bot (ativo / pausado)
- Intake de sinais (ON/OFF)

Controles:
- **✅ / ❌ Auto-trading** — ativar ou desativar (desativar requer confirmação)
- **▶️ Retomar / ⏸️ Pausar** — retomar ou pausar (pausar requer confirmação)
- **🔔 / 🔕 Intake** — ativar ou desativar intake (desativar requer confirmação)

### Detalhe de posição

Clique em qualquer posição na lista para ver a tela de detalhe. A partir daí você pode:
- **🔄 Atualizar** — atualizar os dados da posição
- **🔴 Fechar** — fechar a posição (requer confirmação)
- **🎯 Mod TP** — definir novo take profit (entrada de texto)
- **🛑 Mod SL** — definir novo stop loss (entrada de texto)
- **📉 Reduzir** — reduzir parcialmente a posição (entrada de texto, 1–95%)

---

## Trading Manual

### Abrir uma posição manualmente

Via Telegram: use **📝 Trade Manual** no menu principal.

O bot pede uma única linha neste formato:
```
ATIVO DIREÇÃO ENTRADA TP SL ALAVANCAGEM [MARGEM]
```

Exemplo:
```
SOL LONG 150 165 145 5 isolated
```

Campos:
- `ATIVO` — símbolo do token: `SOL`, `BTC`, `ETH`, etc.
- `DIREÇÃO` — `LONG` ou `SHORT`
- `ENTRADA` — preço de entrada
- `TP` — preço de take profit
- `SL` — preço de stop loss
- `ALAVANCAGEM` — multiplicador de alavancagem
- `MARGEM` — opcional: `isolated` (padrão) ou `cross`

Após enviar, o bot mostra uma tela de confirmação. Toque em **✅ Confirmar Ordem** para executar.

A abertura manual passa pelo mesmo **risk manager** dos sinais automáticos.

Via API REST:
```bash
curl -X POST http://localhost:3000/api/open \
  -H "Content-Type: application/json" \
  -H "X-API-Token: SEU_TOKEN" \
  -d '{"asset":"SOL","direction":"LONG","entry":150,"tp":165,"sl":145,"leverage":5}'
```

### Fechar uma posição

Via Telegram: navegue até a tela de detalhe da posição → **🔴 Fechar** → confirme.

Via dashboard: clique em **Close** ao lado da posição.

Via REST:
```bash
curl -X POST http://localhost:3000/api/close \
  -H "Content-Type: application/json" \
  -H "X-API-Token: SEU_TOKEN" \
  -d '{"asset":"SOL"}'
```

Os closes são venue-aware — o bot resolve automaticamente qual venue detém a posição.

Closes manuais pelo Telegram ou dashboard web são sempre saídas completas a mercado. Em Valiant/Hyperliquid, o bot implementa isso como ordem IOC reduce-only agressiva.

### Atualizar TP/SL

Via Telegram: detalhe da posição → **🎯 Mod TP** ou **🛑 Mod SL** → digite o novo preço → confirme.

Via REST:
```bash
curl -X POST http://localhost:3000/api/tpsl \
  -H "Content-Type: application/json" \
  -H "X-API-Token: SEU_TOKEN" \
  -d '{"asset":"SOL","tp":170}'
```

`tp` e `sl` são opcionais — envie apenas o que quer alterar.

### Redução parcial de posição

Fecha parcialmente uma porcentagem da posição sem sair totalmente.

Intervalo permitido: **1–95%**. Use o close completo para acima de 95%.

Via Telegram: detalhe da posição → **📉 Reduzir** → digite a porcentagem (ex: `25`) → confirme.

Via REST:
```bash
curl -X POST http://localhost:3000/api/reduce \
  -H "Content-Type: application/json" \
  -H "X-API-Token: SEU_TOKEN" \
  -d '{"asset":"SOL","reducePercent":25}'
```

---

## Controles Operacionais

### Intake de sinais (`signalIntakeEnabled`)

Quando desativado, todos os sinais recebidos são descartados silenciosamente antes de qualquer processamento — antes do parse, deduplicação e verificações de risco. Nenhuma entrada `signalIgnored` é criada. Posições abertas não são afetadas.

Use quando:
- recebendo uma enxurrada de sinais inválidos do canal monitorado
- durante gerenciamento manual de posições quando não quer novas entradas automáticas
- durante manutenção, para parar de forma limpa toda atividade de novas posições

Diferença em relação ao pause:
- use **pause** para uma suspensão temporária onde quer que os sinais apareçam no log como "ignorados"
- use **intake off** para um bloqueio total onde não quer nenhum processamento de sinais

Controle:
- Telegram: `⚙️ Config` → **🔕 Desativar Intake** (requer confirmação)
- REST: `POST /api/intake` com `{ "enabled": false }`

### Pausar

O que faz: sinais são recebidos e parseados, mas marcados como `bot_paused` no log de ignorados. Nenhuma execução ocorre.

Diferença do intake: sinais pausados aparecem no histórico. Sinais com intake off são invisíveis.

Controle via menu Telegram ou REST `/api/pause`.

### Auto-trading OFF

O que faz: sinais passam pelos filtros de intake e pausa, mas não são executados. Aparecem no log como `autotrading_disabled`. Útil para "modo observação" — você quer ver quais sinais teriam disparado.

Controle via tela Config do Telegram ou REST `/api/autotrading`.

### Ordem dos filtros

```
Sinal recebido
  │
  ▼ [1] intake ativo?          NÃO → descarte silencioso
  │ SIM
  ▼ [2] pausado?               SIM → signalIgnored('bot_paused')
  │ NÃO
  ▼ [3] autoTrading ativo?     NÃO → signalIgnored('autotrading_disabled')
  │ SIM
  ▼ executeSignal()
```

---

## Rastreamento de Posições e Alertas

O bot rastreia posições abertas automaticamente e envia alertas no Telegram quando:
- uma posição atinge o limite de lucro (`POSITION_ALERT_PROFIT_PERCENT`)
- um trailing stop é ativado
- uma posição é fechada

Configure em `backend/.env`:

```env
ENABLE_POSITION_ALERTS=true
POSITION_ALERT_PROFIT_PERCENT=10     # alerta quando PnL chega a +10%
ENABLE_TRAILING_STOP=true
TRAILING_STOP_PERCENT=5              # trailing 5% abaixo do preço máximo
TRAILING_STOP_ONLY_AFTER_PROFIT_PERCENT=3   # só ativa após +3%
```

Alertas Telegram requerem `TELEGRAM_CHAT_ID` no arquivo de secrets.

# Política de Fechamento

Este documento é a fonte canônica de verdade sobre como o bot resolve a venue durante operações de fechamento.

A política é intencionalmente conservadora e depende da intenção operacional. Ela não aplica o mesmo comportamento de fallback a todos os fluxos de close.

---

## Ordem de Resolução de Venue

Quando um fluxo de close pode resolver a venue dinamicamente, a ordem é:

1. `venue` explícita
2. `venue` da posição rastreada
3. Fallback para a venue ativa

Alguns fluxos podem usar o passo 3. Outros devem falhar de forma segura e recusar o close se a venue não puder ser resolvida pelos passos 1 ou 2.

---

## Política por Intenção Operacional

### Fluxos manuais / operador local

Esses são auxiliars manuais disparados diretamente pelo operador.

Regra:

- o fallback para a venue ativa é permitido
- se o fallback for usado, o bot registra um warning

Objetivo:

- preservar usabilidade manual
- preservar compatibilidade retroativa para ações diretas do operador

Implementação atual:

- `closeManualTrade()` em `backend/src/trading/ManualTradeService.js`
- `closeAllManualTrades()` em `backend/src/trading/ManualTradeService.js`

---

### Fluxos remotos do operador

Esses são closes acionados por humanos a partir de superfícies remotas de controle, como painel ou bot de controle do Telegram.

Regra:

- preferir `venue` explícita ou `venue` da posição rastreada
- se o fluxo passar por caminhos compartilhados de command-bus / admin, ele herda o comportamento fail-safe
- o fallback para a venue ativa não é usado nesses caminhos compartilhados

Objetivo:

- evitar closes na venue errada a partir de superfícies remotas ou assíncronas

Implementação atual:

- fluxos REST e Socket.IO do painel em `backend/src/web/server.js`
- callbacks de close individual no Telegram em `backend/src/telegram/handlers/callbacks.js`

Observações:

- o close individual no Telegram normalmente emite `pos.venue` explicitamente
- os fluxos remotos do operador são intencionalmente mais estritos do que os auxiliars manuais locais
- closes manuais pelo Telegram e painel web são sempre saídas completas a mercado; em Valiant/Hyperliquid isso é implementado como IOC reduce-only agressivo

---

### Fluxos admin / sistema / automação

Esses são closes iniciados por orquestração, automação ou lógica interna de segurança.

Regra:

- o fallback para a venue ativa é bloqueado
- se a venue não puder ser resolvida por entrada explícita ou posição rastreada, o close é recusado
- a recusa deve ser registrada claramente em log

Objetivo:

- falhar de forma segura em vez de adivinhar

Implementação atual:

- manipuladores `cmd:close` e `cmd:close_all` em `backend/src/index.js`
- trailing/system close em `backend/src/trading/position-management/PositionManager.js`

---

## Política de `close_all`

`close_all` é tratado de forma mais conservadora do que o close de uma posição individual.

Regras:

- fluxos `close_all` de command-bus, admin e sistema não usam fallback para a venue ativa
- o auxiliar manual direto `closeAllManualTrades()` ainda permite fallback por compatibilidade retroativa

Objetivo:

- reduzir o raio de impacto de ações amplas

Implementação atual:

- comportamento estrito em `backend/src/index.js`
- fallback ainda permitido no auxiliar manual em `backend/src/trading/ManualTradeService.js`
- o `close_all` do Telegram atualmente usa `state.positions[0]?.venue` sob a suposição prática de uma única venue por vez

---

## Mapeamento de Implementação

### Resolver compartilhado

`backend/src/trading/closeVenueResolver.js`

- resolver canônico para seleção de venue no close
- suporta: `explicit`, `position`, `active_fallback`, `unresolved` quando o fallback está desabilitado

### Helpers manuais

`backend/src/trading/ManualTradeService.js`

- `closeManualTrade()` permite fallback
- `closeAllManualTrades()` permite fallback
- ambos registram quando o fallback é usado

### Closes via command-bus

`backend/src/index.js`

- `cmd:close` chama o resolver com `allowActiveFallback: false`
- `cmd:close_all` chama o resolver com `allowActiveFallback: false`

### Trailing close do sistema

`backend/src/trading/position-management/PositionManager.js`

- trailing/system close chama o resolver com `allowActiveFallback: false`

### Painel

`backend/src/web/server.js`

- fluxos REST / Socket do painel resolvem a venue antes de emitir eventos para o command-bus
- seguem a política estrita do command-bus

### Controle por Telegram

`backend/src/telegram/handlers/callbacks.js`

- close individual normalmente emite `pos.venue` explicitamente
- `close_all` usa `state.positions[0]?.venue`

---

## Limitações Conhecidas

- o rastreamento ainda é por `asset`, não por `asset + venue`
- operação simultânea da mesma `asset` em múltiplas venues ainda não é suportada
- `close_all` ainda reflete a suposição prática de uma única venue por vez
- os fluxos remotos do operador são mais estritos do que os auxiliars manuais locais por design

# Modelo de Venue

O bot usa uma arquitetura multi-venue. O venue ativo é configurado na inicialização e não pode ser alterado em tempo de execução.

---

## Como venues funcionam

Toda chamada de execução de trades passa pelo `PerpExecutionService`, que seleciona o venue ativo no registry e delega ao adaptador apropriado.

O venue ativo é definido por:

```env
PERP_OPEN_VENUE=drift   # drift | jupiter | phoenix
```

Esta variável é lida uma vez na inicialização. `state.status.activeVenue` mostra o nome do venue resolvido — visível na tela de status do Telegram e no dashboard.

---

## Registry de venues

Cada venue tem um **manifest** declarando suas capabilities. As capabilities controlam quais operações o bot tem permissão de tentar.

Em modo paper, o paper engine intercepta todas as chamadas de execução — o adaptador real nunca é ativado.

---

## Venues suportados

### Drift Protocol — `drift`

**Status: Pronto para produção**

| Capability | Suportado |
|-----------|----------|
| Abrir trade | ✅ |
| Fechar trade | ✅ |
| Fechar tudo | ✅ |
| Redução parcial | ✅ |
| Atualizar TP/SL | ✅ |
| Consulta de saldo | ✅ |
| Snapshot de conta | ✅ |
| Ativos suportados | ✅ |
| Limites de mercado | ✅ |
| Alavancagem máxima | ✅ |
| Monitoramento de posições | ✅ |

**Ativos suportados:**

| Ativo | Market Index |
|-------|-------------|
| SOL | 0 |
| BTC | 1 |
| ETH | 2 |
| APT | 3 |
| 1MBONK / BONK | 4 |
| POL / MATIC | 5 |
| ARB | 6 |
| DOGE | 7 |
| BNB | 8 |
| SUI | 9 |
| WIF | 23 |
| JUP | 24 |

**Carteira:** usa `WALLET_DRIFT_PATH` → fallback para `BOT_WALLET_PATH` se não definido.

---

### Jupiter Perpetuals — `jupiter`

**Status: Apenas metadados estáticos — execução live não implementada**

| Capability | Suportado |
|-----------|----------|
| Ativos suportados | ✅ (dados estáticos) |
| Limites de mercado | ✅ (dados estáticos) |
| Alavancagem máxima | ✅ (dados estáticos) |
| Abrir trade | ❌ Não implementado |
| Fechar trade | ❌ Não implementado |
| Redução parcial | ❌ Não implementado |
| Atualizar TP/SL | ❌ Não implementado |
| Monitoramento de posições | ❌ Não implementado |

Definir `PERP_OPEN_VENUE=jupiter` vai gerar erro quando o bot tentar execução live. Use `PAPER_TRADING=true` para rodar modo paper com metadados estáticos do Jupiter.

**Ativos suportados (estáticos):** SOL, BTC, ETH, WIF, BONK, JUP

**Carteira:** `WALLET_JUPITER_PATH` necessário para uso live (ainda não implementado).

---

### Phoenix Perps — `phoenix`

**Status: Apenas metadados estáticos — execução live não implementada**

| Capability | Suportado |
|-----------|----------|
| Ativos suportados | ✅ (dados estáticos) |
| Limites de mercado | ✅ (dados estáticos) |
| Alavancagem máxima | ✅ (dados estáticos) |
| Toda execução | ❌ Não implementado |
| Monitoramento de posições | ❌ Não implementado |

Definir `PERP_OPEN_VENUE=phoenix` vai gerar erro na execução live.

**Ativos suportados (estáticos):** SOL, BTC, ETH

**Carteira:** `WALLET_PHOENIX_PATH` necessário para uso live (ainda não implementado).

---

## Política de capabilities em modo paper

Em modo paper, o bot só exige **capabilities de dados estáticos** do venue:
- `supportsSupportedAssets`
- `supportsMarketLimits`
- `supportsPlatformMaxLeverage`

Todas as chamadas de execução são interceptadas pelo paper engine antes de qualquer verificação de capability para operações de execução. Isso significa que o modo paper funciona com qualquer um dos três venues.

---

## Carteiras por venue

Configure no arquivo de segredos (nunca no `.env`):

```env
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json
WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json
```

Se `WALLET_DRIFT_PATH` não estiver definido, o Drift usa `BOT_WALLET_PATH` como fallback. Jupiter e Phoenix exigem suas próprias carteiras quando a execução live for habilitada.

Cada arquivo de carteira deve ter `chmod 600`, de propriedade do usuário bot.

# Configuração

O bot usa dois arquivos. Mantenha-os separados — um fica no repositório, o outro fica fora.

| Arquivo | Local | O que contém |
|---------|-------|-------------|
| `.env` | `backend/.env` | Configurações de trading, módulos ativos, caminhos — **sem segredos** |
| `bot-secrets.env` | `/opt/bot/secrets/bot-secrets.env` | Credenciais reais — **nunca no repositório** |

---

## Obrigatório — Arquivo de segredos

`/opt/bot/secrets/bot-secrets.env` deve conter as credenciais reais exigidas pelos módulos e pelo backend que você ativar. Para o listener de sinais do Telegram, o mínimo é:

File: `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=seu_hash_aqui
TELEGRAM_PHONE=+5511999999999
```

Se o backend escolhido exigir RPC ou chave de assinatura, adicione esses valores no mesmo arquivo de segredos usando o padrão `*_PATH`. Não coloque chaves brutas no `.env`.

Se você usar o bot de controle do Telegram, adicione também:

File: `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CONTROL_ALLOWED_IDS=123456789
```

O bot **recusa iniciar** se esse arquivo estiver faltando ou qualquer valor ainda for `SET_IN_SERVER_ONLY`.

---

## Obrigatório — Configurações do `.env`

Abra `backend/.env` e defina no mínimo:

File: `backend/.env`

```env
# O canal do Telegram para monitorar
TELEGRAM_CHANNEL_ID=-1001234567890

# Comece no modo seguro — sem operações reais
PAPER_TRADING=true
```

Selecione o backend de execução no `.env`:

File: `backend/.env`

```env
PERP_OPEN_VENUE=drift   # escolha um backend/venue registrado
```

Veja [venues.md](venues.md) para seleção de backend, prontidão e requisitos por backend.

---

## Módulos ativos

Esses parâmetros controlam quais partes do bot iniciam quando você executa `./start.sh`:

File: `backend/.env`

```env
ENABLE_SIGNAL_LISTENER=true   # receber e processar sinais de trading
ENABLE_WEB=true               # painel web em http://localhost:3000
ENABLE_CONTROL_BOT=false      # bot do Telegram para controle remoto
WEB_PORT=3000
```

Configurações comuns:

| O que você quer | Configuração |
|----------------|-------------|
| Só trading | `LISTENER=true  WEB=false  CONTROL=false` |
| Trading + painel | `LISTENER=true  WEB=true   CONTROL=false` |
| Stack completo | `LISTENER=true  WEB=true   CONTROL=true` |

---

## Opcional — Limites de risco

Esses valores têm padrões seguros. Altere só se souber o que está fazendo.

File: `backend/.env`

```env
MAX_LEVERAGE=20             # cap máximo — bot nunca usa mais que isso
MAX_POSITIONS=5             # máximo de operações abertas ao mesmo tempo
POSITION_SIZE_PCT=0.01      # 1% da sua conta por operação (comece aqui)
MIN_FREE_MARGIN_PCT=0.10    # sempre manter 10% dos fundos como reserva
MAX_TOTAL_EXPOSURE_PCT=0.80 # exposição total limitada a 80% do saldo
MAX_SLIPPAGE_BPS=100        # slippage máximo permitido (100 = 1%)
```

---

## Opcional — Caminhos e logs

```env
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
LOG_LEVEL=info    # debug | info | warn | error
LOG_DIR=./logs
```

---

## Carteiras e chaves por backend

O bot suporta arquivos de carteira/chave dedicados por backend. Configure material secreto bruto em arquivos fora do repositório e exponha apenas caminhos pelo arquivo de segredos.

Adicione em `/opt/bot/secrets/bot-secrets.env`:

File: `/opt/bot/secrets/bot-secrets.env`

```env
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json
WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
VALIANT_ACCOUNT_ADDRESS=0xSeuEnderecoPublico
```

**Como funciona:**

| Tipo de backend | Modelo de configuração |
|-----------------|------------------------|
| Backend com wallet Solana | `WALLET_<VENUE>_PATH` ou fallback `BOT_WALLET_PATH` |
| Backend com agent key | `*_AGENT_KEY_PATH` mais endereço/conta pública; caminho da chave da conta principal quando transferências assinadas pelo usuário estiverem habilitadas |

Exemplos atuais:

| Venue/backend | Caminho secreto usado |
|---------------|-----------------------|
| Drift | `WALLET_DRIFT_PATH` → faz fallback para `BOT_WALLET_PATH` se não estiver definido |
| Jupiter | `WALLET_JUPITER_PATH` (obrigatório quando `PERP_OPEN_VENUE=jupiter`) |
| Phoenix | `WALLET_PHOENIX_PATH` (obrigatório quando `PERP_OPEN_VENUE=phoenix`) |
| Compatível com Valiant | `VALIANT_AGENT_KEY_PATH` mais `VALIANT_ACCOUNT_ADDRESS`; `VALIANT_MAIN_KEY_PATH` apenas quando assinatura de transferência spot→perps estiver habilitada |

**Compatibilidade retroativa com Drift:** implantações existentes que definem apenas `BOT_WALLET_PATH` continuam funcionando sem mudanças.

**Caminho de chave ausente = falha segura:** em modo live, o bot recusa iniciar ou executar quando o backend selecionado não tem os caminhos ou credenciais exigidos.

Cada arquivo de carteira/chave deve ter `chmod 600` e pertencer ao usuário do bot.

---

## Gates de auto-trading

O auto-trading global pode ser controlado em tempo de execução pelo dashboard ou pelo bot de controle Telegram. Alguns backends também exigem um flag explícito de inicialização antes de permitir execução automática de sinais.

```env
ENABLE_AUTO_TRADING_VALIANT=false
```

Mantenha gates específicos de backend desativados até passar por testes em paper, preflight e um teste live manual pequeno.

Para Valiant/Hyperliquid, USDC em spot pode contar como equity efetiva mesmo quando o free collateral de perps é zero. A transferência explícita spot→perps é opcional e controlada apenas por `ENABLE_VALIANT_AUTO_MARGIN_TRANSFER`; a avaliação de equity não depende desse gate.

---

## Segurança do dashboard

Por padrão, o dashboard web só permite operações de escrita via localhost. Para habilitar acesso remoto, defina `WEB_API_TOKEN` no arquivo de segredos:

File: `/opt/bot/secrets/bot-secrets.env`

```env
WEB_API_TOKEN=uma-string-aleatoria-longa-aqui
```

Inclua em cada requisição de escrita como header:

```
X-API-Token: uma-string-aleatoria-longa-aqui
```

Operações de leitura (`GET /api/state`, atualizações via WebSocket) são sempre abertas e não requerem autenticação.

---

## Saldo do modo paper

Em modo paper, o paper engine inicia com um saldo simulado. Para alterar o padrão de `$10.000`:

File: `backend/.env`

```env
PAPER_INITIAL_BALANCE=5000
```

Esta é uma configuração opcional — relevante apenas quando `PAPER_TRADING=true`.

---

## Referência completa

Veja [backend/.env.example](../../backend/.env.example) para todas as variáveis disponíveis com comentários.

---

## Nota de segurança operacional

Os fluxos de close são venue-aware e não se comportam todos da mesma forma.

- helpers manuais diretos de close ainda podem usar fallback para a venue ativa por compatibilidade retroativa
- fluxos remotos, command-bus e automatizados são mais estritos e podem recusar o close se a venue não puder ser resolvida com segurança
- closes manuais iniciados pelo Telegram ou dashboard web são sempre saídas completas a mercado; em Valiant/Hyperliquid isso é implementado como IOC reduce-only agressivo

Veja [Política de Close](politica-de-close.md) para as regras detalhadas canônicas.

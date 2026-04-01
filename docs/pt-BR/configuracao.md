# Configuração

O bot usa dois arquivos. Mantenha-os separados — um fica no repositório, o outro fica fora.

| Arquivo | Local | O que contém |
|---------|-------|-------------|
| `.env` | `backend/.env` | Configurações de trading, módulos ativos, caminhos — **sem segredos** |
| `bot-secrets.env` | `/opt/bot/secrets/bot-secrets.env` | Credenciais reais — **nunca no repositório** |

---

## Obrigatório — Arquivo de segredos

`/opt/bot/secrets/bot-secrets.env` deve conter no mínimo:

```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=SUA_CHAVE
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=seu_hash_aqui
TELEGRAM_PHONE=+5511999999999
```

Se você usar o bot de controle do Telegram, adicione também:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CONTROL_ALLOWED_IDS=123456789
```

O bot **recusa iniciar** se esse arquivo estiver faltando ou qualquer valor ainda for `SET_IN_SERVER_ONLY`.

---

## Obrigatório — Configurações do `.env`

Abra `backend/.env` e defina no mínimo:

```env
# O canal do Telegram para monitorar
TELEGRAM_CHANNEL_ID=-1001234567890

# Comece no modo seguro — sem operações reais
PAPER_TRADING=true
```

---

## Módulos ativos

Esses parâmetros controlam quais partes do bot iniciam quando você executa `./start.sh`:

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
BOT_WALLET_PATH=/opt/bot/secrets/drift-bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
LOG_LEVEL=info    # debug | info | warn | error
LOG_DIR=./logs
```

---

## Referência completa

Veja [backend/.env.example](../../backend/.env.example) para todas as variáveis disponíveis com comentários.

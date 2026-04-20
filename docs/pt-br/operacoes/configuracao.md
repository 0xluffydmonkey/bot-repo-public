# Configuração

O bot usa dois arquivos. Mantenha-os separados — um fica no repo, o outro fica fora.

| Arquivo | Localização | O que contém |
|---------|-------------|-------------|
| `.env` | `backend/.env` | Configurações de trading, flags de recurso, caminhos de arquivos — **sem segredos** |
| `bot-secrets.env` | `/opt/bot/secrets/bot-secrets.env` | Credenciais reais — **nunca no repo** |

---

## Obrigatório — Arquivo de segredos

`/opt/bot/secrets/bot-secrets.env` deve conter as credenciais reais exigidas pelos módulos e backend habilitados. Para o listener de sinais Telegram, o mínimo é:

Arquivo: `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=hash_real
TELEGRAM_PHONE=+5511999999999
```

Se seu backend selecionado precisar de endpoint RPC ou chave de assinatura, adicione esses valores no mesmo arquivo de segredos usando o padrão `*_PATH`. Não coloque chaves brutas no `.env`.

Se você usar o bot de controle Telegram, adicione também:

```env
TELEGRAM_BOT_TOKEN=123456789:ABCdef...
TELEGRAM_CONTROL_ALLOWED_IDS=123456789
```

O bot **recusa iniciar** se esse arquivo estiver ausente ou qualquer valor ainda for `SET_IN_SERVER_ONLY`.

---

## Obrigatório — Configurações do `.env`

Abra `backend/.env` e defina no mínimo:

Arquivo: `backend/.env`

```env
# O canal Telegram para monitorar sinais
TELEGRAM_CHANNEL_ID=-1001234567890

# Iniciar em modo seguro — sem trades reais
PAPER_TRADING=true
```

Selecione o backend de execução:

```env
PERP_OPEN_VENUE=drift   # escolha um backend/venue registrado
```

Veja [../negociacao/venues.md](../negociacao/venues.md) para seleção de backend, prontidão e requisitos por backend.

---

## Controles de Recursos

Controlam quais partes do bot rodam ao chamar `./start.sh`:

```env
ENABLE_SIGNAL_LISTENER=true   # receber e processar sinais de trading
ENABLE_WEB=true               # painel web em http://localhost:3000
ENABLE_CONTROL_BOT=false      # bot Telegram para controle remoto
WEB_PORT=3000
```

Configurações comuns:

| O que você quer | Configurações |
|----------------|--------------|
| Só trading | `LISTENER=true  WEB=false  CONTROL=false` |
| Trading + painel | `LISTENER=true  WEB=true   CONTROL=false` |
| Stack completo | `LISTENER=true  WEB=true   CONTROL=true` |

---

## Opcional — Limites de risco

Têm padrões seguros. Mude apenas se souber o que está fazendo.

```env
MAX_LEVERAGE=20             # cap absoluto — bot não usa mais do que isso
MAX_POSITIONS=5             # máximo de trades abertos ao mesmo tempo
POSITION_SIZE_PCT=0.01      # 1% da conta por trade (comece aqui)
MIN_FREE_MARGIN_PCT=0.10    # manter sempre 10% dos fundos como buffer
MAX_TOTAL_EXPOSURE_PCT=0.80 # exposição total aberta limitada a 80% da equity
MAX_SLIPPAGE_BPS=100        # slippage máximo permitido (100 = 1%)
```

---

## Opcional — Reconciliação

O serviço de reconciliação roda automaticamente com padrões seguros. Sobrescreva apenas se necessário:

```env
RECONCILE_INTERVAL_MS=300000       # frequência de execução (padrão: 5 min)
RECONCILE_MIN_TRADE_AGE_MS=60000   # idade mínima para eligibilidade no Pass 1 (padrão: 60 s)
RECONCILE_ENRICH_WINDOW_HOURS=2    # janela de lookback para o Pass 2 (padrão: 2 h)
```

Veja [reconciliacao.md](reconciliacao.md).

---

## Opcional — Caminhos e Logs

```env
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
LOG_LEVEL=info    # debug | info | warn | error
LOG_DIR=./logs
```

---

## Wallets e Chaves de Assinatura por Backend

Configure o material de chave bruto em arquivos fora do repositório e exponha apenas os caminhos pelo arquivo de segredos.

Arquivo: `/opt/bot/secrets/bot-secrets.env`

```env
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json
WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
VALIANT_ACCOUNT_ADDRESS=0xSeuEnderecoPublico
```

| Venue/backend | Path de secret usado |
|---------------|---------------------|
| Drift | `WALLET_DRIFT_PATH` → fallback para `BOT_WALLET_PATH` se não definido |
| Jupiter | `WALLET_JUPITER_PATH` (obrigatório quando `PERP_OPEN_VENUE=jupiter`) |
| Phoenix | `WALLET_PHOENIX_PATH` (obrigatório quando `PERP_OPEN_VENUE=phoenix`) |
| Valiant-compatible | `VALIANT_AGENT_KEY_PATH` mais `VALIANT_ACCOUNT_ADDRESS`; `VALIANT_MAIN_KEY_PATH` apenas quando transferência spot→perps é habilitada |

Path de chave ausente = falha segura: modo ao vivo recusa iniciar quando o backend selecionado não tem os caminhos obrigatórios.

Cada arquivo de wallet/chave deve ter `chmod 600` e ser de propriedade do usuário do bot.

---

## Gates de auto-trading

```env
ENABLE_AUTO_TRADING_VALIANT=false
```

Mantenha os gates específicos de backend desabilitados até que paper testing, pré-validação e um pequeno teste ao vivo manual tenham passado.

---

## Segurança do Painel

Por padrão, o painel só permite operações de escrita a partir de localhost. Para habilitar acesso remoto:

Arquivo: `/opt/bot/secrets/bot-secrets.env`

```env
WEB_API_TOKEN=string_longa_aleatoria_aqui
```

Passe-o em cada requisição de escrita:

```
X-API-Token: string_longa_aleatoria_aqui
```

Operações de leitura (`GET /api/state`, WebSocket) não requerem autenticação.

---

## Saldo do Modo Paper

```env
PAPER_INITIAL_BALANCE=5000
```

Relevante apenas quando `PAPER_TRADING=true`.

---

## Referência completa

Veja `backend/.env.example` para todas as variáveis disponíveis com comentários.

---

## Nota de segurança operacional

Fluxos de close são venue-aware e não se comportam da mesma forma em todos os casos.

- auxiliars manuais de close direto podem usar fallback para a venue ativa por compatibilidade retroativa
- fluxos remotos, de command-bus e automatizados são mais estritos e recusam o close se a venue não puder ser resolvida de forma segura
- closes manuais iniciados pelo Telegram ou painel web são sempre saídas completas a mercado; em Valiant/Hyperliquid isso é implementado como IOC reduce-only agressivo

Veja [../negociacao/politica-de-fechamento.md](../negociacao/politica-de-fechamento.md) para as regras canônicas.

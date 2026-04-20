# Variáveis, Segredos e Caminhos

## Propósito

Definir o padrão seguro de configuração: `.env` sem segredos, segredos fora do projeto e loaders dedicados.

## Público-alvo

Todos que editam configuração, implantação ou documentação.

## Dependências

- `backend/.env.example`
- `backend/src/config/index.js`
- `backend/src/config/validateEnv.js`
- Loaders em `backend/src/services/*Loader.js`

## Onde se encaixa

`backend/src/config/index.js` carrega primeiro `BOT_SECRETS_FILE` e depois `backend/.env`. `validateEnv()` roda fail-fast e bloqueia segredos brutos proibidos.

## Separação Obrigatória

| Tipo | Local |
|------|-------|
| Config não secreta | `backend/.env` |
| Segredos e tokens | `/opt/bot/secrets/bot-secrets.env` |
| Private keys, sessões e DB URL brutas | Arquivos dedicados em `/opt/bot/secrets/*` |

## Variáveis Brutas Bloqueadas

O boot rejeita:

```
WALLET_PRIVATE_KEY
TELEGRAM_SESSION
VALIANT_AGENT_KEY
VALIANT_MAIN_KEY
SUPABASE_DB_URL
```

Use os caminhos:

```env
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
```

## Exemplo de Configuração de Arquivos

```bash
sudo mkdir -p /opt/bot/secrets /opt/bot/wallets
sudo chown -R ubuntu:ubuntu /opt/bot
chmod 700 /opt/bot/secrets /opt/bot/wallets
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
```

Arquivo de segredos:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=hash_real
TELEGRAM_PHONE=+5511999999999
SOLANA_RPC_URL=https://provedor-rpc.example
WEB_API_TOKEN=token_longo_aleatorio
SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
```

Arquivo dedicado para Supabase:

```
postgresql://postgres.xxxxx:senha@aws-0-region.pooler.supabase.com:5432/postgres
```

## Validação

```bash
./scripts/scan-secrets.sh
./start.sh
```

Observação: `scripts/scan-secrets.sh` verifica apenas alguns padrões brutos em arquivos de config do repo. Ele não substitui revisão humana.

## Riscos

- Crítico: private key no `.env`.
- Crítico: sessão Telegram no `.env`.
- Crítico: connection string Supabase no `.env`.
- Alto: permissão maior que `600` em arquivos com secret.
- Médio: caminhos relativos para segredos confundem systemd; prefira caminhos absolutos.

## Resolução de Problemas

- `raw secrets are not accepted`: remova a variável bruta e use `*_PATH`.
- `Missing required secret`: valor não foi carregado do secrets file ou systemd.
- `Placeholder detected`: `SET_IN_SERVER_ONLY` ainda está em uso.

## Lista de Verificação Final

- [ ] `.env` só tem configuração, flags e caminhos
- [ ] Segredos ficam fora do repo
- [ ] Arquivos sensíveis têm `chmod 600`
- [ ] Boot passa pelo fail-fast
- [ ] Nenhum secret aparece em logs, docs ou commits

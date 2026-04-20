# Configuração Local e Desenvolvimento

## Propósito

Configuração local segura para desenvolvimento e validação incremental sem acionar dinheiro real.

## Público-alvo

Desenvolvedores e operadores que precisam testar mudanças sem execução live.

## Dependências

- Node.js 18+
- npm
- Acesso ao repo
- Credenciais Telegram MTProto reais em arquivo externo
- Opcional: Supabase para validar persistência

## Como se encaixa

A configuração local usa o mesmo backend de produção, mas deve rodar com `PAPER_TRADING=true`. O arquivo `backend/.env` fica no repo local com configurações não secretas; segredos ficam em `/opt/bot/secrets/bot-secrets.env` ou outro caminho externo apontado por `BOT_SECRETS_FILE`.

## Passo a Passo

1. Instalar dependências do backend:

```bash
cd backend
npm install
cd ..
```

2. Criar `.env` a partir do exemplo:

```bash
cp backend/.env.example backend/.env
```

3. Manter o `.env` sem segredos. Exemplo mínimo:

```env
TELEGRAM_CHANNEL_ID=-1001234567890
PAPER_TRADING=true
PERP_OPEN_VENUE=drift
ENABLE_SIGNAL_LISTENER=true
ENABLE_WEB=true
ENABLE_CONTROL_BOT=false
WEB_PORT=3000
LOG_LEVEL=info
LOG_DIR=./logs
```

4. Criar a pasta externa de segredos:

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown "$USER":"$USER" /opt/bot/secrets
chmod 700 /opt/bot/secrets
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
```

5. Adicionar apenas os segredos necessários ao arquivo externo:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=hash_real
TELEGRAM_PHONE=+5511999999999
```

6. Iniciar:

```bash
./start.sh
```

7. Se `ENABLE_WEB=true`, abrir:

```
http://localhost:3000
```

## Exemplos Reais

Rodar apenas backend em paper:

```bash
cd backend
npm run paper
```

Rodar stack com painel e bot de controle via flags legacy (ainda suportadas):

```bash
cd backend
npm run full:paper
```

O caminho canônico é definir `ENABLE_WEB` e `ENABLE_CONTROL_BOT` no `.env` e iniciar com `./start.sh`.

## Riscos

- Crítico: não copie private keys para `backend/.env`.
- Crítico: não copie sessão Telegram bruta para `backend/.env`.
- Alto: não rode localmente com `PAPER_TRADING=false` salvo em teste live intencional e isolado.
- Médio: a primeira autenticação Telegram pode gerar `backend/telegram_session.txt` — mova para `/opt/bot/secrets/telegram_session.txt` depois.

## Resolução de Problemas

- `Secrets file not found`: crie `/opt/bot/secrets/bot-secrets.env` ou exporte `BOT_SECRETS_FILE`.
- `Placeholder detected`: substitua `SET_IN_SERVER_ONLY` no arquivo externo, não no `.env`.
- Login Telegram repetindo: confira `TELEGRAM_SESSION_PATH` e permissões do arquivo.
- Porta web ocupada: altere `WEB_PORT`.

## Lista de Verificação Final

- [ ] `PAPER_TRADING=true`
- [ ] `backend/.env` sem segredos
- [ ] `/opt/bot/secrets/bot-secrets.env` com `chmod 600`
- [ ] `./start.sh` sobe sem erros `[CONFIG]`
- [ ] Painel responde quando habilitado

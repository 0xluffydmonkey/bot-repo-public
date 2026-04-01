# Instalação

> **Configuração em 10 minutos.** Siga os passos na ordem.

---

## O que você precisa

- Um computador com Linux ou macOS (Windows via WSL2 também funciona)
- Um arquivo de carteira Solana (`drift-bot-wallet.json`)
- Um endpoint RPC da Solana — obtenha um gratuito no [Helius](https://helius.dev) ou [QuickNode](https://quicknode.com)
- Credenciais da API do Telegram (gratuito — leva 2 minutos)
- O ID do canal do Telegram que você quer monitorar

---

## Passo 1 — Instalar o Node.js

```bash
# Verifique se já está instalado
node --version   # precisa ser 18 ou superior
```

Se não estiver instalado, use o nvm (recomendado):

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

---

## Passo 2 — Clonar e instalar

```bash
git clone git@github.com:YOUR_USER/bot-repo.git
cd bot-repo
cd backend && npm install && cd ..
chmod +x start.sh stop.sh status.sh backend/start.sh
```

---

## Passo 3 — Criar a pasta de segredos

Os segredos ficam **fora** da pasta do projeto para nunca serem enviados ao git por acidente.

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown $USER:$USER /opt/bot/secrets
chmod 700 /opt/bot/secrets
```

---

## Passo 4 — Adicionar sua carteira

Copie uma carteira existente ou gere uma nova:

```bash
# Gerar uma nova carteira
solana-keygen new -o /opt/bot/secrets/drift-bot-wallet.json

# OU copiar uma carteira existente
cp /caminho/para/sua/wallet.json /opt/bot/secrets/drift-bot-wallet.json
```

Restrinja as permissões:

```bash
chmod 600 /opt/bot/secrets/drift-bot-wallet.json
```

> Deposite USDC nessa carteira para operar e ~0,1 SOL para taxas de rede.

---

## Passo 5 — Criar o arquivo de segredos

```bash
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
nano /opt/bot/secrets/bot-secrets.env
```

Cole e preencha com seus valores reais:

```env
SOLANA_RPC_URL=https://mainnet.helius-rpc.com/?api-key=SUA_CHAVE
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=seu_hash_aqui
TELEGRAM_PHONE=+5511999999999
```

Salve e feche (`Ctrl+X`, depois `Y`, depois `Enter` no nano).

---

## Passo 6 — Configurar o bot

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

O mínimo que você precisa definir:

```env
# O canal do Telegram para monitorar os sinais
TELEGRAM_CHANNEL_ID=-1001234567890

# Mantenha como true até ter certeza que tudo funciona
PAPER_TRADING=true
```

Veja [configuracao.md](configuracao.md) para todas as opções disponíveis.

---

## Passo 7 — Iniciar o bot

```bash
./start.sh
```

Na primeira vez, o bot vai pedir seu número de telefone do Telegram e um código de verificação. Depois disso, funciona automaticamente.

---

## Obtendo credenciais do Telegram

**API ID e Hash:**
1. Acesse [my.telegram.org/apps](https://my.telegram.org/apps)
2. Faça login com seu número de telefone
3. Clique em "API development tools"
4. Crie um app (nome e plataforma não importam)
5. Copie o `api_id` (um número) e o `api_hash` (uma string)

**ID do canal:**
Encaminhe qualquer mensagem do seu canal de sinais para `@userinfobot`.
Ele responde: `Forwarded from channel id: -1001234567890`
Use esse número como `TELEGRAM_CHANNEL_ID`.

# Instalação

> **Configuração em 10 minutos.** Siga os passos na ordem.

---

## O que você precisa

- Um computador com Linux ou macOS (Windows via WSL2 também funciona)
- Arquivos de wallet/chave exigidos pelo seu backend de trading selecionado
- Endpoints RPC/API exigidos pelo seu backend selecionado
- Credenciais da API Telegram (gratuitas — leva 2 minutos para obter)
- O ID do canal Telegram que você quer monitorar

---

## Passo 1 — Instalar Node.js

```bash
# Verifique se já tem
node --version   # precisa ser 18 ou superior
```

Se não estiver instalado, use o nvm (recomendado):

```bash
curl -o- https://brutas.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
source ~/.bashrc
nvm install 20
nvm use 20
```

---

## Passo 2 — Clonar e instalar

```bash
git clone git@github.com:SEU_USUARIO/bot-repo.git
cd bot-repo
cd backend && npm install && cd ..
chmod +x start.sh stop.sh status.sh backend/start.sh
```

---

## Passo 3 — Criar a Pasta de Segredos

Segredos são armazenados **fora** da pasta do projeto para nunca serem acidentalmente commitados no git.

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown $USER:$USER /opt/bot/secrets
chmod 700 /opt/bot/secrets
```

---

## Passo 4 — Adicionar arquivos de wallet/chave

Copie ou gere os arquivos de wallet/chave exigidos pelo seu backend selecionado. Armazene-os fora do repositório e restrinja as permissões.

Exemplo para backend Solana keypair:

```bash
# Gerar nova wallet
solana-keygen new -o /opt/bot/secrets/bot-wallet.json

# OU copiar uma wallet existente
cp /caminho/para/sua/wallet.json /opt/bot/secrets/bot-wallet.json
```

Restringir permissões:

```bash
chmod 600 /opt/bot/secrets/bot-wallet.json
```

> Deposite colateral e o ativo de taxas/gas exigidos pelo backend que você vai usar.

---

## Passo 5 — Criar o Arquivo de Segredos

```bash
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
nano /opt/bot/secrets/bot-secrets.env
```

Cole e preencha esses valores:

Arquivo: `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=hash_real
TELEGRAM_PHONE=+5511999999999
```

Adicione segredos específicos de backend apenas se seu backend selecionado os exigir. Veja [../operacoes/configuracao.md](../operacoes/configuracao.md).

Salve e feche (`Ctrl+X`, depois `Y`, depois `Enter` no nano).

---

## Passo 6 — Configurar o bot

```bash
cp backend/.env.example backend/.env
nano backend/.env
```

O mínimo que você precisa definir:

Arquivo: `backend/.env`

```env
TELEGRAM_CHANNEL_ID=-1001234567890   # o canal para monitorar
PAPER_TRADING=true                    # mantenha true até ter confiança
```

Veja [../operacoes/configuracao.md](../operacoes/configuracao.md) para todas as configurações disponíveis.

---

## Passo 7 — Iniciar o bot

```bash
./start.sh
```

Na primeira vez, ele vai pedir seu número de telefone Telegram e um código de verificação. Depois disso, roda automaticamente.

---

## Obtendo credenciais Telegram

**API ID e Hash:**
1. Acesse [my.telegram.org/apps](https://my.telegram.org/apps)
2. Faça login com seu número de telefone
3. Clique em "API development tools"
4. Crie um app (nome e plataforma não importam)
5. Copie o `api_id` (um número) e o `api_hash` (uma string)

**ID do canal:**
Encaminhe qualquer mensagem do seu canal de sinais para `@userinfobot`.
Ele responde com: `Forwarded from channel id: -1001234567890`
Use esse número como `TELEGRAM_CHANNEL_ID`.

---

## Lista de Verificação de Validação

- [ ] `node --version` mostra 18 ou superior
- [ ] `npm install` concluiu sem erros
- [ ] `/opt/bot/secrets/bot-secrets.env` existe com `chmod 600`
- [ ] `backend/.env` criado a partir do exemplo
- [ ] `./start.sh` inicia sem erros `[CONFIG]`
- [ ] Painel em `http://localhost:3000` responde (se `ENABLE_WEB=true`)

# Executando o Bot

---

## Iniciar

```bash
./start.sh
```

É só isso. O que roda é controlado pelas configurações em `backend/.env`.

---

## Primeiro uso — Login no Telegram

Na primeira vez que iniciar, o bot precisa fazer login no Telegram pelo seu número. Ele vai perguntar:

```
Enter your phone number: +5511999999999
Enter the code you received: 12345
```

Depois disso, salva uma sessão e não pede mais.

Mova o arquivo de sessão para a pasta de segredos:

```bash
mv backend/telegram_session.txt /opt/bot/secrets/telegram_session.txt
chmod 600 /opt/bot/secrets/telegram_session.txt
```

---

## O que esperar ao iniciar

```
[START] Loading secrets from: /opt/bot/secrets/bot-secrets.env
[START] node: v20.x.x
[CONFIG] Secret loaded: SOLANA_RPC_URL ✓
[CONFIG] Secret loaded: TELEGRAM_API_ID ✓
[TELEGRAM] Authenticated successfully
[BOT] Active — waiting for signals
[WEB] Dashboard available at http://localhost:3000
```

Se você vê essas linhas, o bot está funcionando corretamente.

---

## Parar

```bash
./stop.sh
```

---

## Verificar status

```bash
./status.sh
```

---

## Modo paper vs operações reais

**Modo paper** (seguro — sem transações reais):

```env
# backend/.env
PAPER_TRADING=true
```

O bot lê os sinais e os valida por todas as camadas de risco, mas **não envia transações** para a blockchain. Use por pelo menos 24 horas para verificar que tudo funciona antes de operar com dinheiro real.

**Operações reais:**

```env
# backend/.env
PAPER_TRADING=false
```

Sinais que passarem por todas as validações de risco serão executados on-chain com fundos reais.

> Recomendação: comece com `PAPER_TRADING=true` + `POSITION_SIZE_PCT=0.01` por 24h, depois aumente gradualmente.

---

## Arquivo de segredos em caminho diferente

Se seus segredos estão em um lugar diferente do padrão:

```bash
BOT_SECRETS_FILE=/caminho/para/secrets.env ./start.sh
```

---

## Rodar 24/7 em servidor

Use o systemd para que o bot reinicie automaticamente após reinicializações ou falhas. Veja [systemd.md](systemd.md).

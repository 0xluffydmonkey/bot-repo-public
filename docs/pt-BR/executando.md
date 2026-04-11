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
[CONFIG] Secret loaded: TELEGRAM_API_ID ✓
[CONFIG] Secret loaded: <credenciais específicas do backend> ✓
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

File: `backend/.env`

```env
# backend/.env
PAPER_TRADING=true
```

O bot executa o pipeline completo de processamento de sinais e simula a execução — nenhuma transação blockchain é enviada. O dashboard mostra posições e PnL simulados reais. Use por pelo menos 24 horas antes de operar com dinheiro real.

**Operações reais:**

File: `backend/.env`

```env
# backend/.env
PAPER_TRADING=false
```

Sinais que passarem por todas as validações de risco serão enviados ao backend live selecionado com fundos reais.

> Recomendação: comece com `PAPER_TRADING=true` + `POSITION_SIZE_PCT=0.01` por 24h, depois aumente gradualmente.

Veja [modo-paper.md](modo-paper.md) para a comparação completa de comportamento paper vs live.

---

## Controles operacionais

Uma vez que o bot está rodando, você pode controlá-lo sem reiniciar via:
- o dashboard em `http://localhost:3000` (se `ENABLE_WEB=true`)
- o bot de controle Telegram (se `ENABLE_CONTROL_BOT=true`)

Controles disponíveis em tempo de execução:

| Controle | Efeito |
|---------|--------|
| Pausar | Suspende execução de sinais (sinais registrados como ignorados) |
| Retomar | Retorna o bot à execução normal |
| Auto-trading OFF | Modo só-monitoramento — nenhum novo trade é executado |
| Intake OFF | Descarta silenciosamente todos os sinais antes do processamento |
| Fechar posição | Fecha uma posição aberta a mercado |
| Fechar tudo | Fecha todas as posições abertas a mercado |
| Abertura manual | Abre uma posição manualmente (não depende do listener de sinais) |
| Atualizar TP/SL | Altera take profit ou stop loss de uma posição aberta |
| Redução parcial | Reduz uma posição em 1–95% a mercado |

Veja [guia-do-operador.md](guia-do-operador.md) para instruções completas de cada controle.

---

## Arquivo de segredos em caminho diferente

Se seus segredos estão em um lugar diferente do padrão:

```bash
BOT_SECRETS_FILE=/caminho/para/secrets.env ./start.sh
```

---

## Rodar 24/7 em servidor

Use o systemd para que o bot reinicie automaticamente após reinicializações ou falhas. Veja [systemd.md](systemd.md).

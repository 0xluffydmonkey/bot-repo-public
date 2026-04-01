# Solução de Problemas

---

## Bot não inicia

**"Secrets file not found"**

O arquivo `/opt/bot/secrets/bot-secrets.env` não existe ou o caminho está errado.

```bash
ls -la /opt/bot/secrets/bot-secrets.env
```

Se não existir, crie:

```bash
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
nano /opt/bot/secrets/bot-secrets.env
```

---

**"Missing required secret: SOLANA_RPC_URL"**

O arquivo existe mas ainda tem um valor de placeholder (`SET_IN_SERVER_ONLY`). Abra o arquivo e substitua pelo valor real:

```bash
nano /opt/bot/secrets/bot-secrets.env
```

---

**"node binary not found"**

O Node.js não está instalado ou não está no caminho esperado.

```bash
node --version   # se falhar, instale o Node.js
```

Instale via nvm:

```bash
nvm install 20 && nvm use 20
```

---

**"Permission denied"**

Os scripts não têm permissão de execução.

```bash
chmod +x start.sh stop.sh status.sh backend/start.sh
```

---

## Problemas com o Telegram

**Autenticação em loop / "phone code invalid"**

O arquivo de sessão está corrompido ou desatualizado. Delete e faça login novamente:

```bash
rm /opt/bot/secrets/telegram_session.txt
./start.sh
```

Após a nova sessão ser criada, mova-a:

```bash
mv backend/telegram_session.txt /opt/bot/secrets/telegram_session.txt
chmod 600 /opt/bot/secrets/telegram_session.txt
```

---

**"Not authorized" / sessão expirada**

Sessões do Telegram expiram após um período sem uso ou se forem revogadas. Regenere seguindo os passos acima.

---

**Não consigo encontrar o ID do canal**

Encaminhe qualquer mensagem do canal de sinais para `@userinfobot` no Telegram. Ele vai responder:

```
Forwarded from channel id: -1001234567890
```

Use esse número (incluindo o sinal de menos) como `TELEGRAM_CHANNEL_ID` no `backend/.env`.

---

## Problemas com o systemd

**Serviço não inicia**

```bash
sudo systemctl status bot-trader
journalctl -u bot-trader -n 50 --no-pager
```

Causas comuns:

| Mensagem de erro | Solução |
|-----------------|---------|
| `Secrets file not found` | Crie `/opt/bot/secrets/bot-secrets.env` |
| `ConditionPathExists failed` | `backend/.env` não existe — rode `cp backend/.env.example backend/.env` |
| `node binary not found` | Verifique a instalação do nvm |
| `Permission denied` | `chmod +x start.sh backend/start.sh` |

---

**Serviço fica reiniciando**

```bash
journalctl -u bot-trader -b --no-pager | grep -E '(Started|Failed|Stopping)'
```

---

## Problemas com operações

**Nenhuma operação está sendo executada**

Verifique se o modo paper está ativo:

```bash
grep PAPER_TRADING backend/.env
```

Se `PAPER_TRADING=true`, o bot valida os sinais mas não envia transações. Isso é esperado.

---

**Gerenciador de risco rejeitando todos os sinais**

Verifique os logs do bot para ver o motivo. Causas comuns:

- `MAX_POSITIONS` já atingido — aguarde uma posição fechar
- Margem livre abaixo de `MIN_FREE_MARGIN_PCT` — adicione fundos ou reduza o limite
- Relação risco/retorno do sinal abaixo de 1:1 — os sinais da fonte são de baixa qualidade
- Ativo não suportado — o sinal menciona um token que o Drift não lista

---

**Sinais não estão sendo detectados**

Verifique se `TELEGRAM_CHANNEL_ID` está correto e igual ao do canal (incluindo o `-` para IDs de canais).

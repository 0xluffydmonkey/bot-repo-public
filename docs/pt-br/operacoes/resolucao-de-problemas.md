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

**"Missing required secret: SOLANA_RPC_URL" ou outra credencial de backend**

O arquivo existe, mas o módulo/backend selecionado está sem um valor obrigatório ou ainda tem placeholder (`SET_IN_SERVER_ONLY`). Abra o arquivo de segredos e substitua placeholders por valores reais:

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

Verifique na ordem:

1. Modo paper: `grep PAPER_TRADING backend/.env` — se `true`, nenhuma operação real é esperada.
2. Intake de sinais: verifique o painel ou `/config` no Telegram — o **Intake** está ON?
3. Pausa: verifique o painel ou `/config` — o bot está **Pausado**?
4. Auto-trading: verifique o painel ou `/config` — o **Auto-trading** está ON?

Se os três estiverem ativos e ainda não houver trades, verifique o log de sinais (`/signals` no Telegram ou o painel de sinais do painel) para ver se os sinais estão chegando.

---

**Intake desativado — sinais não aparecem no log de ignorados**

Esse é o comportamento esperado. Quando o intake está desativado, os sinais são descartados silenciosamente antes de qualquer processamento — não aparecem no log. Para voltar a ver os sinais, reative o intake:
- Telegram: `⚙️ Config` → `🔔 Ativar Intake`
- REST: `POST /api/intake` com `{ "enabled": true }`

---

**Gerenciador de risco rejeitando todos os sinais**

Verifique os logs para ver o motivo. Causas comuns:

- `MAX_POSITIONS` já atingido — aguarde uma posição fechar
- Margem livre abaixo de `MIN_FREE_MARGIN_PCT` — adicione fundos ou reduza o limite
- Relação R:R do sinal abaixo de 1:1 — os sinais da fonte são de baixa qualidade
- Ativo não suportado — o sinal menciona um token que o venue ativo não lista

---

**Sinais não estão sendo detectados**

Verifique se `TELEGRAM_CHANNEL_ID` está correto e igual ao do canal (incluindo o `-` para IDs de canais).

Verifique também se o intake de sinais está ativo (veja acima).

---

## Problemas com backend / venue

**"Venue '<nome>' does not support openTrade"**

O backend selecionado está registrado, mas não expõe capability de execução live nesta codebase. Solução:
- escolha um backend live-ready em `PERP_OPEN_VENUE`
- mantenha `PAPER_TRADING=true` enquanto testa metadados estáticos e validação de risco

---

**"Execution adaptador not registered for venue"**

O valor de `PERP_OPEN_VENUE` não corresponde a nenhum backend/venue registrado. Valores registrados atualmente incluem `drift`, `jupiter`, `phoenix` e `valiant`. Verifique erros de digitação no `.env`.

---

**"Wallet/key not configured for venue"**

O backend selecionado exige uma wallet ou chave de assinatura que está faltando no arquivo de segredos. Use o modelo `*_PATH`:

Arquivo: `/opt/bot/secrets/bot-secrets.env`

```env
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
```

Nunca coloque private keys brutas no `.env` ou em `bot-secrets.env`.

---

**Auto-trading está ON globalmente, mas ordens automáticas live continuam bloqueadas**

Alguns backends têm um gate explícito extra de inicialização. Verifique flags específicas como:

```env
ENABLE_AUTO_TRADING_VALIANT=true
```

Ative isso apenas depois de paper testing, pré-validação e um pequeno teste ao vivo manual.

---

## Problemas com painel

**Painel mostra dados desatualizados**

O painel atualiza via WebSocket. Se a conexão caiu:
- Recarregue a página — o WebSocket vai reconectar automaticamente
- Verifique se o backend ainda está rodando: `./status.sh`

---

**API REST retorna 401**

`WEB_API_TOKEN` está definido mas você não está enviando no header da requisição.

```bash
curl -X POST http://localhost:3000/api/pause \
  -H "X-API-Token: SEU_TOKEN"
```

---

**API REST retorna 403**

`WEB_API_TOKEN` não está definido e você está conectando de um endereço não-localhost. Defina `WEB_API_TOKEN` no arquivo de segredos para acesso remoto ou conecte apenas de localhost.

---

## Problemas com trades manuais

**Abertura manual rejeitada — "risk manager"**

O trade manual falhou na validação de risco. Motivos comuns:
- Ativo não está na lista suportada pelo venue ativo
- TP/SL resulta em R:R < 1:1 (TP muito perto da entrada, ou SL muito longe)
- `MAX_POSITIONS` já atingido
- Colateral livre insuficiente

---

**Redução parcial rejeitada — "baseToReduce < minBase"**

A porcentagem digitada resultaria em um tamanho de ordem abaixo do mínimo do venue. Tente uma porcentagem maior, ou use o fechamento total.

---

**Redução parcial rejeitada — "baseRemaining < minBase"**

Após a redução, a posição remanescente ficaria abaixo do tamanho mínimo do venue. Aumente a porcentagem para deixar uma posição remanescente maior, ou use o fechamento total.

---

## Problemas com reconciliação

**Trades travados em status OPEN**

O serviço de reconciliação deve detectar trades `OPEN` no banco que desapareceram da venue ativa e fechá-los automaticamente. Verifique se está rodando:

```bash
journalctl -u bot-trader | grep '\[RECONCILE\]'
```

Se não aparecem logs de reconciliação, o serviço pode não ter iniciado. Verifique `backend/src/index.js` por `startReconciliation()`.

Se os logs aparecem mas o trade continua `OPEN`, confira:

- A venue do trade corresponde à venue ativa. Logs com `reconcile_venue_skip` indicam que o trade pertence a uma venue não reconciliada neste ciclo.
- `fetchPositions()` está funcionando. Logs com `reconcile_fetch_failed` indicam que a passagem de close abortou sem efeitos colaterais.
- O trade é mais antigo que `RECONCILE_MIN_TRADE_AGE_MS`.
- `recordTradeClosed()` encontrou a identidade do trade. Se aparecer fallback por `symbol+venue`, verifique o trade por `symbol`, `venue` e timestamps.

Veja [reconciliacao.md](reconciliacao.md) para o fluxo completo de identidade.

**Posição manual na venue não apareceu no banco**

A adoção externa não é imediata. A posição na venue ativa precisa aparecer em 2 ciclos consecutivos de reconciliação antes de ser persistida como trade `OPEN` com `open_source='venue_reconciliation'`.

Logs esperados:

```text
event: adopt_candidate_seen
event: adopt_external_position
event: trade_external_adopted
```

Se ela não aparecer:

- Confirme que a posição está na venue ativa.
- Confira `adopt_fetch_failed`; adoção não roda com snapshot não confiável.
- Confira `adopt_candidate_expired`; a posição desapareceu antes da confirmação.
- Confira `adopt_skip_no_direction`; o adaptador não forneceu `LONG`/`SHORT` confiável.

**Adoção não ocorreu por ambiguidade**

Logs com `adopt_skip_ambiguous` indicam que o banco já tem múltiplos trades `OPEN` para o mesmo `venue + asset` ativo. O bot não tenta adivinhar qual deles corresponde à posição live. Resolva o estado duplicado no banco antes de esperar adoção.

**Exit price permanece null após close externo**

O enriquecimento do Pass 2 só suporta `valiant`/Hyperliquid. Para outras venues, `exit_price` permanecerá null a menos que você atualize o banco manualmente.

Para valiant, verifique se `RECONCILE_ENRICH_WINDOW_HOURS` é suficientemente grande para cobrir o tempo entre o close e o próximo ciclo de reconciliação.

Se o trade foi adotado externamente, a mesma limitação se aplica: a adoção cria e rastreia o trade `OPEN`, mas o enriquecimento após close ainda depende do suporte a histórico de fills da venue e da janela configurada.

**Fallback por symbol+venue apareceu nos logs**

Este é um caminho de close de último recurso usado quando `bot_trade_ref` e id de banco em memória estão indisponíveis, geralmente após restart com tracking antigo ou incompleto. Deve ser raro. Verifique se o trade afetado tem `symbol`, `venue`, `opened_at` e `closed_at` corretos, depois confira se o tracking foi restaurado com `bot_trade_ref`.

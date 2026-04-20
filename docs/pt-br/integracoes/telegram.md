# Integração Telegram

## Propósito

Documentar a integração Telegram: listener MTProto para sinais, sessão por arquivo externo e bot de controle opcional.

## Público-alvo

Operadores que configuram sinais, controle remoto e alertas.

## Dependências

- `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, `TELEGRAM_PHONE`
- `TELEGRAM_CHANNEL_ID`
- `TELEGRAM_SESSION_PATH` (recomendado)
- Opcional: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CONTROL_ALLOWED_IDS`

## Onde se encaixa

- Listener de sinais: `backend/src/telegram/telegram_listener.js`
- Sessão: `backend/src/services/telegramSessionLoader.js`
- Control bot: `backend/src/telegram/telegram_control.js`
- Handlers: `backend/src/telegram/handlers/*`
- UI: `backend/src/telegram/ui/*`

## Padrão Seguro de Sessão

Não use `TELEGRAM_SESSION` em env. O boot rejeita essa variável brutas. Use:

```env
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
```

O loader tenta:

1. `TELEGRAM_SESSION_PATH`
2. Fallback local `backend/telegram_session.txt` (apenas para compatibilidade de primeiro boot)

Depois do primeiro login interativo, mova a sessão para fora do repo:

```bash
mv backend/telegram_session.txt /opt/bot/secrets/telegram_session.txt
chmod 600 /opt/bot/secrets/telegram_session.txt
```

## Configuração

Em `/opt/bot/secrets/bot-secrets.env`:

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=hash_real
TELEGRAM_PHONE=+5511999999999
```

Em `backend/.env`:

```env
TELEGRAM_CHANNEL_ID=-1001234567890
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
ENABLE_SIGNAL_LISTENER=true
```

Para o bot de controle:

```env
ENABLE_CONTROL_BOT=true
```

Em `/opt/bot/secrets/bot-secrets.env`:

```env
TELEGRAM_BOT_TOKEN=token_do_botfather
TELEGRAM_CONTROL_ALLOWED_IDS=123456789,987654321
```

## Operação Remota

O bot de controle permite pausar, retomar, controlar auto-trading, abrir trades manuais, fechar, reduzir e atualizar TP/SL conforme manipuladores existentes.

Regras importantes:

- IDs autorizados devem estar em `TELEGRAM_CONTROL_ALLOWED_IDS`.
- Se `ENABLE_CONTROL_BOT=true`, o fail-fast exige token e IDs.
- Fechamentos remotos usam resolução de venue mais estrita que auxiliars locais.

## Formato de Trade Manual

Texto livre de uma linha no bot de controle:

```
SOL LONG 150 165 142 5 isolated
```

Campos:

```
ATIVO DIREÇÃO ENTRADA TP SL ALAVANCAGEM [MARGEM]
```

## Riscos

- Crítico: sessão Telegram brutas no `.env` ou commitada.
- Alto: `TELEGRAM_CONTROL_ALLOWED_IDS` vazio pode permitir acesso amplo dependendo da configuração.
- Alto: bot de controle habilitado em live sem operadores revisados.
- Médio: canal errado em `TELEGRAM_CHANNEL_ID` gera silêncio operacional.

## Resolução de Problemas

- Login interativo aparece sempre: confira `TELEGRAM_SESSION_PATH`, conteúdo e permissão.
- Sinais não chegam: confirme canal, conta autorizada no canal e `ENABLE_SIGNAL_LISTENER=true`.
- Control bot não responde: confira token, polling, allowed IDs e logs `[CTRL]`.
- Acesso negado: compare seu user ID com `TELEGRAM_CONTROL_ALLOWED_IDS`.

## Lista de Verificação Final

- [ ] Sessão está fora do repo
- [ ] `TELEGRAM_SESSION` não existe no ambiente
- [ ] Listener inicia e monitora o canal correto
- [ ] Control bot (se habilitado) tem allowed IDs explícitos
- [ ] Em live, comandos remotos foram testados primeiro em paper

# Implantação e Operação em VM Ubuntu

## Propósito

Documentar o caminho operacional para rodar o bot em uma VM Ubuntu com baixo risco e sem expor segredos no repositório.

## Público-alvo

Operadores responsáveis por staging/produção em VM.

## Dependências

- VM Ubuntu com usuário dedicado ou usuário operacional restrito
- Node.js 18+
- git
- npm
- systemd
- Arquivos de secret fora do repo

## Onde se encaixa

O repo fica em um path operacional, por exemplo `/home/ubuntu/bot-repo`. Segredos ficam em `/opt/bot/secrets`. O systemd executa `./start.sh`, que delega para `backend/start.sh`.

## Passo a Passo

1. Preparar diretórios externos:

```bash
sudo mkdir -p /opt/bot/secrets /opt/bot/wallets
sudo chown -R ubuntu:ubuntu /opt/bot
chmod 700 /opt/bot/secrets /opt/bot/wallets
```

2. Configurar o arquivo de segredos:

```bash
touch /opt/bot/secrets/bot-secrets.env
chmod 600 /opt/bot/secrets/bot-secrets.env
```

3. Configurar `backend/.env` com apenas valores não secretos.

4. Instalar dependências:

```bash
cd /home/ubuntu/bot-repo/backend
npm install
```

5. Testar manualmente antes do systemd:

```bash
cd /home/ubuntu/bot-repo
./start.sh
```

6. Depois da validação manual, instalar systemd. Veja [systemd.md](systemd.md).

## Exemplo de `backend/.env` Seguro

```env
TELEGRAM_CHANNEL_ID=-1001234567890
PAPER_TRADING=true
PERP_OPEN_VENUE=drift
ENABLE_SIGNAL_LISTENER=true
ENABLE_WEB=true
ENABLE_CONTROL_BOT=false
WEB_PORT=3000
TELEGRAM_SESSION_PATH=/opt/bot/secrets/telegram_session.txt
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
```

## Exemplo de `/opt/bot/secrets/bot-secrets.env`

```env
TELEGRAM_API_ID=12345678
TELEGRAM_API_HASH=hash_real
TELEGRAM_PHONE=+5511999999999
SOLANA_RPC_URL=https://provedor-rpc.example
WEB_API_TOKEN=token_longo_aleatorio
```

Não coloque private key, sessão Telegram brutas ou connection string Supabase diretamente no repo. Para Supabase use `SUPABASE_DB_URL_PATH`.

## Validações

```bash
journalctl -u bot-trader -n 100 -o cat
curl -sS http://127.0.0.1:3000/api/state
```

## Riscos

- Crítico: segredos dentro do repo ou permissão aberta em `/opt/bot/secrets`.
- Alto: painel exposto remotamente sem `WEB_API_TOKEN`.
- Alto: operação ao vivo ligado antes de paper e pré-validação.
- Médio: systemd apontando para repo/path antigo.

## Resolução de Problemas

- `ConditionPathExists` falha: confira caminhos no arquivo de service.
- `node binary not found`: instale Node 18+ ou ajuste o ambiente do usuário systemd.
- Sem logs de arquivo: confira `LOG_DIR` e permissão de escrita.

## Lista de Verificação Final

- [ ] Bot inicia manualmente em paper
- [ ] Segredos externos existem com `chmod 600`
- [ ] systemd habilitado e `active (running)`
- [ ] Painel remoto (se usado) protegido por token
- [ ] Live só após lista de verificação específico de operação ao vivo

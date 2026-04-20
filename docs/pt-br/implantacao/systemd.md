# Systemd — Implantação em Produção

> **Avançado.** Necessário apenas se você quiser que o bot rode continuamente em um servidor e reinicie automaticamente após quedas ou reinicializações.

---

## Antes de começar

Certifique-se de que o bot funciona manualmente primeiro:

```bash
./start.sh   # deve iniciar sem erros
# Pressione Ctrl+C para parar
```

Confirme também que o arquivo de sessão Telegram já está em `/opt/bot/secrets/` (veja [execucao.md](../operacoes/execucao.md)).

---

## Instalar o service

```bash
sudo cp backend/deploy/systemd/bot-trader.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable bot-trader
```

Arquivos:
- origem: `backend/deploy/systemd/bot-trader.service`
- service instalado: `/etc/systemd/system/bot-trader.service`

`enable` significa que o service iniciará automaticamente no boot.

---

## Iniciar e verificar

```bash
sudo systemctl start bot-trader
sudo systemctl status bot-trader
```

Você deve ver `Active: active (running)`.

---

## Comandos de controle

```bash
sudo systemctl start bot-trader      # iniciar
sudo systemctl stop bot-trader       # parar
sudo systemctl restart bot-trader    # reiniciar (após mudanças de código ou .env)
sudo systemctl status bot-trader     # status
```

Ou use os scripts raiz:

```bash
./stop.sh
./status.sh
```

---

## Ver logs

```bash
# Acompanhar em tempo real (limpo)
journalctl -u bot-trader -f -o cat

# Últimas 100 linhas
journalctl -u bot-trader -n 100

# Filtrar mensagens de inicialização
journalctl -u bot-trader -n 50 | grep '\[START\]\|\[CONFIG\]'

# Filtrar atividade do bot
journalctl -u bot-trader -f | grep '\[BOT\]'
```

---

## Atualizar o bot

```bash
git pull
cd backend && npm install && cd ..   # só se package.json mudou
sudo systemctl restart bot-trader
sudo systemctl status bot-trader
```

---

## Sobrescrever configurações sem editar arquivos

```bash
sudo systemctl edit bot-trader
```

Arquivo criado/atualizado pelo systemd: `/etc/systemd/system/bot-trader.service.d/override.conf`

Exemplo — forçar modo paper:

Arquivo: `/etc/systemd/system/bot-trader.service.d/override.conf`

```ini
[Service]
Environment=PAPER_TRADING=true
```

Salvar e reiniciar:

```bash
sudo systemctl restart bot-trader
```

---

## Desinstalar

```bash
sudo systemctl stop bot-trader
sudo systemctl disable bot-trader
sudo rm /etc/systemd/system/bot-trader.service
sudo systemctl daemon-reload
```

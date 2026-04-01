# TradeFinderBot

> **Read in English:** [README.md](README.md)

Bot de trading algorítmico que monitora um canal privado do Telegram em busca de sinais e executa operações automaticamente no [Drift Protocol](https://drift.trade/) (perpétuos na Solana).

---

## Início Rápido

```bash
git clone git@github.com:YOUR_USER/bot-repo.git
cd bot-repo
./start.sh
```

Só isso. O bot inicia, valida seus segredos e aguarda sinais.

---

## Checklist do Primeiro Uso

Antes de rodar `./start.sh` pela primeira vez:

- [ ] Node.js >= 18 instalado (`node --version`)
- [ ] `npm install` executado dentro de `backend/`
- [ ] `backend/.env` criado a partir de `backend/.env.example`
- [ ] Arquivo de segredos criado em `/opt/bot/secrets/bot-secrets.env`
- [ ] Carteira (keypair) em `/opt/bot/secrets/drift-bot-wallet.json`
- [ ] `chmod +x start.sh stop.sh status.sh`

Veja [docs/pt-BR/instalacao.md](docs/pt-BR/instalacao.md) para instruções passo a passo.

---

## Modo Seguro

Sempre comece no modo seguro. Defina isso em `backend/.env`:

```env
PAPER_TRADING=true
```

No modo seguro, o bot lê os sinais e os valida, mas **não envia nenhuma transação**. Rode por pelo menos 24 horas antes de mudar para operações reais.

---

## Comandos

```bash
./start.sh    # iniciar o bot
./stop.sh     # parar o bot
./status.sh   # verificar se está rodando
```

---

## Documentação

| Guia | |
|------|-|
| [Instalação](docs/pt-BR/instalacao.md) | O que você precisa e como configurar |
| [Configuração](docs/pt-BR/configuracao.md) | Configurações, segredos, módulos ativos |
| [Executando](docs/pt-BR/executando.md) | Iniciar, parar, primeiro uso, paper vs real |
| [Systemd](docs/pt-BR/systemd.md) | Auto-inicialização em servidor (avançado) |
| [Solução de Problemas](docs/pt-BR/problemas.md) | Correções para erros comuns |

---

## Avisos

- Alavancagem pode resultar em liquidação total da posição
- Comece com `POSITION_SIZE_PCT=0.01` (1%) e modo paper
- Mantenha SOL na carteira para taxas de rede (~0,1 SOL)
- Nunca invista mais do que pode perder

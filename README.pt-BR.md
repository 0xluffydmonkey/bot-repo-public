# TradeFinderBot

> **Read in English:** [README.md](README.md)

Bot de trading algorítmico que monitora um canal privado do Telegram em busca de sinais e executa operações automaticamente no [Drift Protocol](https://drift.trade/) (perpétuos na Solana).

Suporta paper trading, gerenciamento manual de posições, dashboard em tempo real, bot de controle pelo Telegram e arquitetura multi-venue.

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
- [ ] Carteira (keypair) em `/opt/bot/secrets/drift-bot-wallet.json` (definida como `BOT_WALLET_PATH`)
- [ ] `chmod +x start.sh stop.sh status.sh`

Veja [docs/pt-BR/instalacao.md](docs/pt-BR/instalacao.md) para instruções passo a passo.

---

## Modo Seguro

Sempre comece em modo paper. Defina isso em `backend/.env`:

```env
PAPER_TRADING=true
```

No modo paper, o bot lê os sinais, os valida por todas as camadas de risco e simula a execução — **nenhuma transação real é enviada**. Rode por pelo menos 24 horas antes de mudar para operações reais.

Veja [docs/pt-BR/modo-paper.md](docs/pt-BR/modo-paper.md) para o comportamento detalhado do paper vs live.

---

## Comandos

```bash
./start.sh    # iniciar o bot
./stop.sh     # parar o bot
./status.sh   # verificar se está rodando
```

---

## O que o bot faz

1. Monitora um canal privado do Telegram em busca de sinais de trading formatados
2. Extrai do sinal: ativo, direção, preço de entrada, TP, SL, alavancagem
3. Valida cada sinal em 7 camadas de risco (cap de alavancagem, R:R, saldo, exposição, step size)
4. Executa perpétuos on-chain via o venue configurado (padrão: Drift Protocol)
5. Monitora posições abertas e envia alertas de PnL pelo Telegram
6. Aceita comandos manuais (abrir, fechar, reduzir, TP/SL) pelo dashboard e pelo Telegram

---

## Modos Operacionais

| Configuração | Comportamento |
|-------------|--------------|
| `PAPER_TRADING=true` | Simula operações, sem transações reais |
| `PAPER_TRADING=false` | Trading ao vivo com fundos reais |

Controles operacionais (alteráveis em tempo real):

| Controle | O que faz |
|---------|----------|
| Pausar | Suspende execução de sinais (sinais são registrados como ignorados) |
| Auto-trading OFF | Monitora sinais sem executar |
| Intake OFF | Descarta silenciosamente todos os sinais recebidos |

---

## Módulos Ativos

```env
ENABLE_SIGNAL_LISTENER=true   # listener MTProto do Telegram para sinais
ENABLE_WEB=true               # dashboard em http://localhost:3000
ENABLE_CONTROL_BOT=false      # bot Telegram de controle remoto
```

---

## Documentação

| Guia | Descrição |
|------|-----------|
| [Instalação](docs/pt-BR/instalacao.md) | Pré-requisitos e configuração |
| [Configuração](docs/pt-BR/configuracao.md) | Todas as variáveis, segredos, módulos |
| [Executando](docs/pt-BR/executando.md) | Iniciar, parar, primeiro uso |
| [Modo Paper](docs/pt-BR/modo-paper.md) | Comportamento paper vs live |
| [Venues](docs/pt-BR/venues.md) | Modelo de venue, status de suporte |
| [Guia do Operador](docs/pt-BR/guia-do-operador.md) | Dashboard, Telegram, trading manual, controles operacionais |
| [Política de Close](docs/pt-BR/politica-de-close.md) | Regras de resolução de venue para closes |
| [Systemd](docs/pt-BR/systemd.md) | Auto-inicialização em servidor |
| [Solução de Problemas](docs/pt-BR/problemas.md) | Erros comuns e soluções |

---

## Avisos

- Alavancagem pode resultar em liquidação total da posição
- Comece com `POSITION_SIZE_PCT=0.01` (1%) e modo paper por pelo menos 24h
- Mantenha SOL na carteira para taxas de rede (~0,1 SOL)
- Nunca invista mais do que pode perder
- A qualidade dos sinais determina a qualidade das operações — você é responsável pela fonte dos sinais

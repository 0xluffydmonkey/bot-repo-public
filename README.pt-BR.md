# TradeFinderBot

> **Read in English:** [README.md](README.md)

Plataforma de bot trader algorítmico que monitora um canal privado do Telegram em busca de sinais e pode executar operações perpétuas pelo backend/venue configurado.

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
- [ ] Arquivos de carteira/chaves necessários fora do repositório e referenciados por variáveis `*_PATH`
- [ ] `chmod +x start.sh stop.sh status.sh`

Veja o indice modular atual em [docs/README.md](docs/README.md) para os guias operacionais. Os guias antigos em [docs/pt-BR](docs/pt-BR) continuam disponiveis como referencia.

---

## Modo Seguro

Sempre comece em modo paper. Defina isso em `backend/.env`:

File: `backend/.env`

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
4. Executa operações perpétuas pelo venue/backend configurado quando o modo live está ativo
5. Monitora posições abertas e envia alertas de PnL pelo Telegram
6. Aceita comandos manuais (abrir, fechar, reduzir, TP/SL) pelo dashboard e pelo Telegram

Closes manuais pelo Telegram ou dashboard web são saídas completas a mercado por decisão operacional; em Valiant/Hyperliquid isso é implementado com ordens IOC reduce-only agressivas.

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
# File: backend/.env
ENABLE_SIGNAL_LISTENER=true   # listener MTProto do Telegram para sinais
ENABLE_WEB=true               # dashboard em http://localhost:3000
ENABLE_CONTROL_BOT=false      # bot Telegram de controle remoto
```

---

## Documentação

A documentacao atual esta organizada por componente em [docs/README.md](docs/README.md). Comece por la para seguranca, Supabase, systemd, Telegram, dashboard, paper/live trading, venues, persistencia e troubleshooting.

| Guia | Descrição |
|------|-----------|
| [Indice da Documentacao](docs/README.md) | Documentacao modular atual |
| [Visao Geral da Arquitetura](docs/architecture/overview.md) | Arquitetura e fluxos existentes |
| [Setup Local](docs/setup/local-development.md) | Desenvolvimento local seguro |
| [VM Ubuntu](docs/deployment/ubuntu-vm.md) | Operacao em VM |
| [systemd](docs/deployment/systemd.md) | Servico, logs e overrides |
| [Telegram](docs/integrations/telegram.md) | Listener, sessao por arquivo e control bot |
| [Dashboard](docs/integrations/dashboard.md) | Dashboard web e autenticacao da API |
| [Supabase](docs/integrations/supabase.md) | Setup PostgreSQL e schema completo |
| [Secrets e Paths](docs/security/secrets-and-paths.md) | Segredos fora do repo |
| [Lacunas e Riscos](docs/operations/gaps-and-risks.md) | Classificacao de riscos conhecidos |
| [Instalação](docs/pt-BR/instalacao.md) | Pré-requisitos e configuração |
| [Configuração](docs/pt-BR/configuracao.md) | Todas as variáveis, segredos, módulos |
| [Executando](docs/pt-BR/executando.md) | Iniciar, parar, primeiro uso |
| [Modo Paper](docs/pt-BR/modo-paper.md) | Comportamento paper vs live |
| [Backends / Venues](docs/pt-BR/venues.md) | Seleção genérica de backend e status de suporte |
| [Guia do Operador](docs/pt-BR/guia-do-operador.md) | Dashboard, Telegram, trading manual, controles operacionais |
| [Política de Close](docs/pt-BR/politica-de-close.md) | Regras de resolução de venue para closes |
| [Systemd](docs/pt-BR/systemd.md) | Auto-inicialização em servidor |
| [Solução de Problemas](docs/pt-BR/problemas.md) | Erros comuns e soluções |

---

## Avisos

- Alavancagem pode resultar em liquidação total da posição
- Comece com `POSITION_SIZE_PCT=0.01` (1%) e modo paper por pelo menos 24h
- Mantenha o ativo necessário para taxas/rede disponível no backend escolhido
- Nunca invista mais do que pode perder
- A qualidade dos sinais determina a qualidade das operações — você é responsável pela fonte dos sinais

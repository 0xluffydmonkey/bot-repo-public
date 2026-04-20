# TradeFinderBot — Documentação em Português

Referência técnica e operacional completa para o TradeFinderBot.

---

## Arquitetura

| Guia | Descrição |
|------|-----------|
| [Visão Geral da Arquitetura](arquitetura/visao-geral.md) | Estrutura do sistema, fluxo de sinais, mapa de componentes |

---

## Configuração

| Guia | Descrição |
|------|-----------|
| [Instalação](instalacao/instalacao.md) | Pré-requisitos, primeira configuração passo a passo |
| [Desenvolvimento Local](instalacao/desenvolvimento-local.md) | Configuração local segura para desenvolvedores |

---

## Implantação

| Guia | Descrição |
|------|-----------|
| [VM Ubuntu](implantacao/vm-ubuntu.md) | Implantação em VM com segredos fora do repo |
| [Systemd](implantacao/systemd.md) | Inicialização automática, logs, atualizações, operação 24/7 |

---

## Integrações

| Guia | Descrição |
|------|-----------|
| [Telegram](integracoes/telegram.md) | Listener MTProto, arquivo de sessão, bot de controle |
| [Painel web](integracoes/painel.md) | Painel web, API REST, autenticação |
| [Supabase / PostgreSQL](integracoes/supabase.md) | Persistência externa, esquema completo, configuração |

---

## Negociação

| Guia | Descrição |
|------|-----------|
| [Modo Paper](negociacao/modo-paper.md) | Simulação segura — comece aqui |
| [Operação ao vivo](negociacao/operacao-ao-vivo.md) | Configuração ao vivo e lista de verificação de pré-validação |
| [Venues / backends](negociacao/venues.md) | Seleção de backend, capacidades, prontidão |
| [Política de fechamento](negociacao/politica-de-fechamento.md) | Regras de resolução de venue para operações de close |

---

## Operações

| Guia | Descrição |
|------|-----------|
| [Configuração](operacoes/configuracao.md) | Todas as configurações, segredos, flags de recurso |
| [Executando](operacoes/execucao.md) | Iniciar, parar, status, primeiro uso |
| [Guia do Operador](operacoes/guia-do-operador.md) | Painel, Telegram, trades manuais, controles |
| [Observabilidade](operacoes/observabilidade.md) | Logs, estado, métricas |
| [Reconciliação](operacoes/reconciliacao.md) | Reconciliação bidirecional venue/banco, adoção externa e enriquecimento |
| [Resolução de problemas](operacoes/resolucao-de-problemas.md) | Erros comuns e soluções |
| [Lacunas e Riscos](operacoes/lacunas-e-riscos.md) | Limitações conhecidas e mitigações |

---

## Segurança

| Guia | Descrição |
|------|-----------|
| [Segredos e caminhos](seguranca/segredos-e-caminhos.md) | Padrão `*_PATH`, variáveis brutas bloqueadas |
| [Segurança Operacional](seguranca/seguranca-operacional.md) | Regras de endurecimento |

---

# TradeFinderBot — Documentação em Português

Referência técnica e operacional completa para o TradeFinderBot.

---

## Arquitetura

| Guia | Descrição |
|------|-----------|
| [Visão Geral da Arquitetura](architecture/overview.md) | Estrutura do sistema, fluxo de sinais, mapa de componentes |

---

## Setup

| Guia | Descrição |
|------|-----------|
| [Instalação](setup/installation.md) | Pré-requisitos, primeiro setup passo a passo |
| [Desenvolvimento Local](setup/local-development.md) | Setup local seguro para desenvolvedores |

---

## Deploy

| Guia | Descrição |
|------|-----------|
| [VM Ubuntu](deployment/ubuntu-vm.md) | Deploy em VM com secrets fora do repo |
| [Systemd](deployment/systemd.md) | Auto-start, logs, atualizações, operação 24/7 |

---

## Integrações

| Guia | Descrição |
|------|-----------|
| [Telegram](integrations/telegram.md) | Listener MTProto, arquivo de sessão, control bot |
| [Dashboard](integrations/dashboard.md) | Dashboard web, API REST, autenticação |
| [Supabase / PostgreSQL](integrations/supabase.md) | Persistência externa, schema completo, setup |

---

## Trading

| Guia | Descrição |
|------|-----------|
| [Modo Paper](trading/paper-mode.md) | Simulação segura — comece aqui |
| [Live Trading](trading/live-trading.md) | Configuração live e checklist de preflight |
| [Venues / Backends](trading/venues.md) | Seleção de backend, capabilities, prontidão |
| [Política de Close](trading/close-policy.md) | Regras de resolução de venue para operações de close |

---

## Operações

| Guia | Descrição |
|------|-----------|
| [Configuração](operations/configuration.md) | Todas as configurações, secrets, feature flags |
| [Executando](operations/running.md) | Start, stop, status, primeiro uso |
| [Guia do Operador](operations/operator-guide.md) | Dashboard, Telegram, trading manual, controles |
| [Observabilidade](operations/observability.md) | Logs, estado, métricas |
| [Reconciliação](operations/reconciliation.md) | Detecção de closes externos e enriquecimento de trades |
| [Troubleshooting](operations/troubleshooting.md) | Erros comuns e soluções |
| [Lacunas e Riscos](operations/gaps-and-risks.md) | Limitações conhecidas e mitigações |

---

## Segurança

| Guia | Descrição |
|------|-----------|
| [Secrets e Paths](security/secrets-and-paths.md) | Padrão `*_PATH`, variáveis raw bloqueadas |
| [Segurança Operacional](security/operational-security.md) | Regras de hardening |

---

> **English documentation:** [../../docs/en/README.md](../en/README.md)

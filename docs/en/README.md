# TradeFinderBot — English Documentation

Complete technical and operational reference for TradeFinderBot.

---

## Architecture

| Guide | Description |
|-------|-------------|
| [Architecture Overview](architecture/overview.md) | System structure, signal flow, component map |

---

## Setup

| Guide | Description |
|-------|-------------|
| [Installation](setup/installation.md) | Prerequisites, step-by-step first install |
| [Local Development](setup/local-development.md) | Safe local setup for developers |

---

## Deployment

| Guide | Description |
|-------|-------------|
| [Ubuntu VM](deployment/ubuntu-vm.md) | VM deployment with secrets outside the repo |
| [Systemd](deployment/systemd.md) | Auto-start, logs, updates, 24/7 operation |

---

## Integrations

| Guide | Description |
|-------|-------------|
| [Telegram](integrations/telegram.md) | MTProto signal listener, session file, control bot |
| [Dashboard](integrations/dashboard.md) | Web dashboard, REST API, authentication |
| [Supabase / PostgreSQL](integrations/supabase.md) | External persistence, full schema, setup |

---

## Trading

| Guide | Description |
|-------|-------------|
| [Paper Mode](trading/paper-mode.md) | Safe simulation — start here |
| [Live Trading](trading/live-trading.md) | Live configuration and pre-flight checklist |
| [Venues / Backends](trading/venues.md) | Backend selection, capabilities, readiness |
| [Close Policy](trading/close-policy.md) | Venue resolution rules for close operations |

---

## Operations

| Guide | Description |
|-------|-------------|
| [Configuration](operations/configuration.md) | All settings, secrets, feature flags |
| [Running](operations/running.md) | Start, stop, status, first run |
| [Operator Guide](operations/operator-guide.md) | Dashboard, Telegram, manual trading, controls |
| [Observability](operations/observability.md) | Logs, state, metrics |
| [Reconciliation](operations/reconciliation.md) | External close detection and trade enrichment |
| [Troubleshooting](operations/troubleshooting.md) | Common errors and fixes |
| [Gaps and Risks](operations/gaps-and-risks.md) | Known limitations and mitigations |

---

## Security

| Guide | Description |
|-------|-------------|
| [Secrets and Paths](security/secrets-and-paths.md) | `*_PATH` pattern, blocked raw vars |
| [Operational Security](security/operational-security.md) | Hardening rules |

---

> **Portuguese documentation:** [../../docs/pt-br/README.md](../pt-br/README.md)

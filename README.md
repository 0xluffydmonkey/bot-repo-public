# Trading Bot

Bot de trading com backend, frontend e integração com Solana / Drift / Telegram.

## Ambientes
- local: desenvolvimento sem segredos reais
- staging: testes controlados
- produção: operação com wallet dedicada

## Regras de segurança
Leia antes de qualquer alteração:
- `SECURITY.md`
- `docs/secrets.md`
- `docs/deploy.md`

## Setup
1. copiar `.env.example` para `.env`
2. preencher apenas configurações seguras
3. manter segredos fora do projeto
4. rodar backend/frontend localmente

## Observação
Este repositório não deve conter:
- private keys
- telegram sessions
- wallets reais
- arquivos sensíveis de produção

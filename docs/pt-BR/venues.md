# Backends / Venues

O bot é multi-backend. Um backend, também chamado de venue no código, é a integração de trading usada para execução live, snapshot de conta, limites de mercado e monitoramento de posições.

O backend ativo é selecionado na inicialização:

File: `backend/.env`

```env
PERP_OPEN_VENUE=drift
```

Esse valor é lido uma vez quando o processo inicia. Para trocar de backend, edite `backend/.env` e reinicie o bot.

---

## Como a Seleção de Backend Funciona

Todos os fluxos de execução passam pelo `PerpExecutionService`. O serviço lê o backend ativo no registry de venues e roteia a operação para o adapter correspondente.

Cada backend declara capabilities como:

- abrir e fechar trades
- fechar todas as posições
- redução parcial
- atualização de TP/SL
- saldo e snapshot de conta
- monitoramento de posições
- ativos suportados, limites de mercado e alavancagem máxima

Em modo live, o bot falha cedo se o backend selecionado não oferecer as capabilities obrigatórias.

---

## Backends Registrados Atualmente

| Backend | Papel pretendido | Prontidão live nesta codebase |
|---------|------------------|-------------------------------|
| `drift` | Backend de perps na Solana | Capaz de produção |
| `valiant` | Backend compatível com API Hyperliquid via Valiant | Capaz de produção, protegido por gate explícito de auto-trading |
| `jupiter` | Metadados estáticos / backend futuro de execução | Não pronto para live |
| `phoenix` | Metadados estáticos / backend futuro de execução | Não pronto para live |

Use a tabela como retrato do estado da codebase, não como recomendação. Sempre rode paper mode e preflight específico do backend antes de operar live.

---

## Modelo de Configuração

Configurações genéricas no `.env`:

File: `backend/.env`

```env
PERP_OPEN_VENUE=drift
PAPER_TRADING=true
```

Segredos brutos nunca devem ir no `.env`. Use o arquivo de segredos e variáveis `*_PATH`:

File: `/opt/bot/secrets/bot-secrets.env`

```env
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
VALIANT_ACCOUNT_ADDRESS=0xSeuEnderecoPublico
```

URLs não secretas específicas de backend podem ficar no `.env`:

File: `backend/.env`

```env
JUPITER_API_BASE_URL=https://api.jup.ag
PHOENIX_API_BASE_URL=https://api.phoenix.trade
VALIANT_BASE_URL=https://api.hyperliquid.xyz
```

Valiant/Hyperliquid usa uma agent/API wallet para assinatura de ordens. `VALIANT_MAIN_KEY_PATH` só é necessário ao habilitar operações de transferência spot→perps assinadas pela conta principal.

---

## Modo Paper

O modo paper entende o backend ativo, mas não chama adapters de execução live. O paper engine intercepta a execução enquanto ainda usa metadados do backend para verificações de risco:

- ativos suportados
- caps de alavancagem da plataforma
- mínimos de mercado e step sizes

Isso permite testar parser de sinais, risk checks, dashboard e controles manuais sem enviar ordens reais.

---

## Checklist Para Live

Antes de definir `PAPER_TRADING=false`:

- Confirme que o backend selecionado está live-ready nesta codebase.
- Configure arquivos de wallet/chave fora do repositório.
- Use `chmod 600` em todos os arquivos de wallet/chave/sessão.
- Rode qualquer script de preflight específico disponível em `backend/scripts/`.
- Comece com `POSITION_SIZE_PCT=0.01`.
- Mantenha o auto-trading global desligado até um teste live manual pequeno funcionar.
- Ative gates específicos de backend apenas após preflight e teste manual.

Gate explícito atual:

File: `backend/.env`

```env
ENABLE_AUTO_TRADING_VALIANT=false
```

Nota de margem Valiant/Hyperliquid: USDC em spot pode ser tratado como equity efetiva mesmo quando o free collateral de perps é zero. A transferência explícita spot→perps é opcional e protegida por `ENABLE_VALIANT_AUTO_MARGIN_TRANSFER`.

Nota de TP/SL Valiant/Hyperliquid: TP/SL usa trigger orders nativas com `triggerPx`, preço limite agressivo válido `p`, `grouping: "positionTpsl"` e números normalizados em wire format antes da assinatura. Operadores devem verificar se as trigger orders foram aceitas pela venue.

---

## Limitações Conhecidas

- O backend ativo é selecionado na inicialização e não pode ser alterado em runtime.
- Posições simultâneas no mesmo ativo em múltiplos backends ainda não são suportadas.
- O tracking de posições ainda é efetivamente por ativo em vários fluxos.
- Algumas ações amplas, como `close_all`, dependem da capability do backend e podem ser recusadas de forma segura.

---

## Nota Para Desenvolvedores

Para adicionar um novo backend de forma incremental:

1. Crie um manifest em `backend/src/venues/manifests/`.
2. Registre em `backend/src/venues/registerBuiltInVenues.js`.
3. Implemente adapters de execução e monitoramento.
4. Adicione segredos exigidos em `validateEnv.js` usando o padrão `*_PATH`.
5. Documente apenas a configuração genérica mais as notas específicas mínimas necessárias para operar com segurança.

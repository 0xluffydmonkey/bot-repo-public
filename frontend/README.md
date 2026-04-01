# Trade Bot Dashboard

Dashboard local premium para monitoramento e controle de bot de trade, construído com React, TypeScript, Vite, Tailwind, Socket.IO e TanStack Query.

## O que está pronto

- tema dark premium com alternância para light
- atualização em tempo real via Socket.IO
- fallback resiliente via `GET /api/state`
- cards executivos com status principais
- painel operacional com pausa, retomada, toggle de auto-trading e fechamento global com confirmação forte
- tabela profissional de posições com filtro, ordenação e ação por ativo
- área de logs/eventos locais em tempo real
- painéis de analytics preparados para evolução do state
- arquitetura modular e escalável

## Estrutura

```text
trade-bot-dashboard/
├─ public/
├─ src/
│  ├─ api/
│  ├─ components/
│  │  ├─ charts/
│  │  ├─ controls/
│  │  ├─ layout/
│  │  ├─ logs/
│  │  ├─ metrics/
│  │  ├─ positions/
│  │  ├─ status/
│  │  └─ ui/
│  ├─ hooks/
│  ├─ lib/
│  ├─ pages/
│  ├─ providers/
│  ├─ store/
│  └─ types/
├─ index.html
├─ package.json
├─ tailwind.config.ts
├─ vite.config.ts
└─ README.md
```

## Como rodar localmente

### 1) Backend do bot
Seu servidor atual já expõe os endpoints REST e Socket.IO. Pelo arquivo enviado, ele serve estáticos a partir de `public/` e publica `state` por Socket.IO. fileciteturn0file0L1-L67

### 2) Rodar o frontend em desenvolvimento
Dentro da pasta do dashboard:

```bash
npm install
npm run dev
```

O Vite sobe em `http://localhost:5173` e faz proxy automático para o backend em `http://localhost:3000`.

### 3) Build para integrar no seu servidor atual
Para gerar os assets estáticos:

```bash
npm run build
```

Isso gera a pasta `dist/`.

### 4) Build direto para o `public/` do seu backend
Se quiser que o Express entregue a interface final diretamente, use uma destas abordagens:

#### Opção A: copiar manualmente
Copie o conteúdo de `dist/` para a pasta `public/` do seu backend.

#### Opção B: build direto no diretório de estáticos
No Linux/macOS:

```bash
VITE_STATIC_OUT_DIR=../src/web/public npm run build
```

No Windows PowerShell:

```powershell
$env:VITE_STATIC_OUT_DIR="../src/web/public"; npm run build
```

Ajuste o caminho conforme a estrutura real do seu projeto.

## Contrato de dados esperado do state

O frontend é tolerante a evolução do backend. Hoje ele tenta ler estes campos quando existirem:

```ts
{
  paused?: boolean
  autoTrading?: boolean
  updatedAt?: string
  positions?: Array<{
    asset: string
    side?: string
    quantity?: number
    entryPrice?: number
    currentPrice?: number
    pnl?: number
    pnlPct?: number
    exposure?: number
    risk?: string
    updatedAt?: string
  }>
  logs?: Array<{
    id?: string
    message: string
    level?: 'info' | 'success' | 'warning' | 'error'
    source?: 'system' | 'user' | 'backend'
    timestamp?: string
  }>
  metrics?: {
    pnl?: number
    pnlPct?: number
    trades?: number
    winRate?: number
    drawdown?: number
    exposure?: number
    exposureByAsset?: Array<{ asset: string; value: number }>
    equityCurve?: Array<{ time: string; value: number }>
  }
  alerts?: Array<{
    id?: string
    title: string
    description?: string
    severity: 'info' | 'success' | 'warning' | 'error' | 'critical'
  }>
}
```

Mesmo que o backend ainda não entregue tudo, a UI já possui placeholders elegantes e adapters para acomodar novos campos depois.

## Melhorias futuras recomendadas

- autenticação local com PIN operacional para comandos destrutivos
- auditoria persistente em banco local
- watchlists customizadas por operador
- heatmap de risco e exposição por classe de ativo
- painel de saúde do processo do bot: heartbeat, latência, fila de eventos, consumo de memória
- gráficos intraday com zoom, brush e marcação de eventos operacionais
- exportação CSV/JSON de logs e posições
- modo multi-instância para vários bots

## Observação sobre integração

O arquivo do backend que você enviou aceita tanto REST quanto comandos por Socket.IO, mas hoje o frontend usa REST como canal principal de comando e Socket.IO para observabilidade em tempo real, que é a estratégia mais segura para UX previsível e debugging simples. Os eventos `cmd:*` permanecem disponíveis para expansão futura. fileciteturn0file0L15-L61

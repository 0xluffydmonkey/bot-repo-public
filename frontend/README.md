# Trade Bot Dashboard

Dashboard local para monitoramento e controle do bot trader, construído com React, TypeScript, Vite, Tailwind, Socket.IO e TanStack Query.

## O Que Está Pronto

- atualização em tempo real via Socket.IO
- fallback resiliente via `GET /api/state`
- cards de status e métricas principais
- painel operacional com pausa, retomada, auto-trading e fechamento com confirmação
- tabela de posições com filtros, ordenação e ações por ativo
- área de logs/eventos locais em tempo real
- estrutura modular para evoluir novos campos do backend

## Como Rodar Localmente

### 1. Backend

O backend expõe endpoints REST e Socket.IO. Ele serve os assets estáticos finais a partir de `backend/src/web/public/` e publica o `state` em tempo real por Socket.IO.

### 2. Desenvolvimento

```bash
npm install
npm run dev
```

Directory: `frontend/`

O Vite sobe em `http://localhost:5173` e faz proxy para o backend em `http://localhost:3000`.

### 3. Build

```bash
npm run build
```

Directory: `frontend/`

Para gerar o build direto no diretório servido pelo backend:

```bash
npm run build:backend
```

Directory: `frontend/`

## Contrato de Dados

O frontend consome o snapshot de `GET /api/state` e eventos Socket.IO `state`. Ele deve continuar tolerante a campos ausentes para permitir evolução incremental do backend.

Campos principais esperados:

```ts
{
  account?: object
  positions?: Array<object>
  signals?: object
  errors?: Array<object>
  status?: {
    running?: boolean
    paused?: boolean
    autoTrading?: boolean
    signalIntakeEnabled?: boolean
    mode?: 'paper' | 'live'
    activeVenue?: string
  }
  session?: object
  lastUpdate?: string | Date
}
```

## Integração

O frontend usa REST como canal principal de comando e Socket.IO para observabilidade em tempo real. Essa separação mantém a UX previsível e facilita debugging.

Comandos críticos no backend exigem `WEB_API_TOKEN` para acesso remoto, ou ficam restritos a localhost quando o token não está configurado.

File: `/opt/bot/secrets/bot-secrets.env`

# Supabase / PostgreSQL

## Propósito

Documentar do zero a configuração Supabase usada pelo projeto para persistência externa, auditoria de trades, métricas do painel e deduplicação de notificações Telegram.

## Público-alvo

Operadores, mantenedores e revisores que precisam criar, migrar ou validar o banco.

## Status da Integração

Já implementado:

- `pg` como cliente PostgreSQL em `backend/src/services/persistenceService.js`
- Conexão lazy via `SUPABASE_DB_URL_PATH`
- Persistência best-effort de trades, eventos, ordens, snapshots, decisões e notificações
- Endpoints do painel para métricas e auditoria
- Fail-fast bloqueando `SUPABASE_DB_URL` brutas no ambiente

Parcialmente implementado:

- Migrations formais versionadas não existem no repo; o esquema abaixo deve ser aplicado manualmente no SQL Editor do Supabase ou por ferramenta externa controlada.
- Persistência não bloqueia trading; falhas geram logs e dados históricos incompletos.

Não implementado:

- Uso de Supabase REST, anon key ou service role key pelo bot.
- RLS para acesso direto por frontend; o frontend fala com o backend, não com o Supabase diretamente.

## Onde se encaixa no fluxo

`persistenceService.init()` roda no boot. Se `SUPABASE_DB_URL_PATH` não estiver definido, a persistência externa é desabilitada e o bot continua.

Durante operação:

- Abertura de trade: insere em `trades`, `trade_events`, `orders`, `balance_snapshots`, `signal_decisions`
- Fechamento: atualiza `trades`, insere evento e ordem de close quando há `bot_trade_ref`
- Notificações Telegram: usa `telegram_notifications_sent` para deduplicar alertas entre restarts
- Painel: lê `trades` para métricas e tabelas de auditoria por `bot_trade_ref`

## Dependências e Pré-requisitos

- Conta Supabase
- Projeto Supabase criado
- Senha do banco ou connection string PostgreSQL
- Esquema SQL aplicado
- Arquivo externo com connection string:

```
/opt/bot/secrets/supabase-db-url.txt
```

- Variável de path em `/opt/bot/secrets/bot-secrets.env`:

```env
SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
```

## Obrigatório vs Opcional

Obrigatório para trading: nada do Supabase. O bot opera sem ele.

Obrigatório para métricas/auditoria externa:

- Projeto Supabase
- Connection string PostgreSQL em arquivo externo
- `SUPABASE_DB_URL_PATH`
- Tabelas do esquema abaixo

Não necessário hoje:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- RLS para acesso pelo painel

## Padrão Seguro de Segredos

Não use:

```env
SUPABASE_DB_URL=postgresql://...
```

O boot rejeita essa variável. Use:

```env
SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
```

Criar o arquivo:

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown "$USER":"$USER" /opt/bot/secrets
chmod 700 /opt/bot/secrets
printf '%s\n' 'postgresql://postgres.xxxxx:SENHA@aws-0-region.pooler.supabase.com:5432/postgres' > /opt/bot/secrets/supabase-db-url.txt
chmod 600 /opt/bot/secrets/supabase-db-url.txt
```

Substitua o exemplo pela connection string real. Não commite esse arquivo.

## Como Criar o Projeto no Supabase

1. Acesse o painel do Supabase.
2. Crie um novo projeto.
3. Escolha região próxima da VM quando possível.
4. Defina uma senha forte para o banco.
5. Aguarde o projeto ficar ativo.
6. Abra `Project Settings` → `Database`.
7. Copie a connection string PostgreSQL. Para VM, prefira o pooler quando disponível.
8. Grave a connection string no arquivo externo `supabase-db-url.txt`.
9. Abra `SQL Editor` e aplique o esquema completo abaixo.

## Esquema SQL Completo

Execute este SQL uma vez no SQL Editor do Supabase. Ele é idempotente para tabelas/índices principais.

```sql
create extension if not exists pgcrypto;

create table if not exists trades (
  id             uuid primary key default gen_random_uuid(),
  bot_trade_ref  text unique,
  symbol         text not null,
  side           text not null check (side in ('LONG', 'SHORT')),
  status         text not null check (status in ('OPEN', 'CLOSED', 'CANCELLED')),
  mode           text not null check (mode in ('paper', 'live')),
  source         text not null check (source in ('auto', 'telegram', 'painel', 'system')),
  venue          text not null,
  strategy_name  text,
  entry_price    numeric,
  exit_price     numeric,
  size           numeric,
  leverage       numeric,
  realized_pnl   numeric,
  opened_at      timestamp not null default now(),
  closed_at      timestamp,
  created_at     timestamp not null default now(),
  constraint trades_closed_requires_closed_at
    check (status <> 'CLOSED' or closed_at is not null),
  constraint trades_open_has_no_closed_at
    check (status <> 'OPEN' or closed_at is null)
);

create index if not exists idx_trades_symbol_venue_status
  on trades (symbol, venue, status);

create index if not exists idx_trades_mode_closed_at
  on trades (mode, closed_at);

create index if not exists idx_trades_bot_trade_ref
  on trades (bot_trade_ref);

create table if not exists trade_events (
  id             uuid primary key default gen_random_uuid(),
  event_type     text not null,
  bot_trade_ref  text,
  payload        jsonb,
  occurred_at    timestamp not null default now(),
  created_at     timestamp not null default now()
);

create index if not exists idx_trade_events_ref_created
  on trade_events (bot_trade_ref, created_at);

create index if not exists idx_trade_events_type_created
  on trade_events (event_type, created_at);

create table if not exists orders (
  id             uuid primary key default gen_random_uuid(),
  bot_trade_ref  text not null,
  trade_id       uuid references trades(id) on delete set null,
  order_id       text,
  venue          text not null,
  symbol         text not null,
  side           text not null check (side in ('LONG', 'SHORT', 'CLOSE')),
  size           numeric,
  price          numeric,
  status         text not null default 'FILLED'
                 check (status in ('FILLED', 'OPEN', 'CANCELLED', 'FAILED')),
  created_at     timestamp not null default now()
);

create index if not exists idx_orders_ref_created
  on orders (bot_trade_ref, created_at);

create index if not exists idx_orders_trade_id
  on orders (trade_id);

create table if not exists balance_snapshots (
  id                 uuid primary key default gen_random_uuid(),
  bot_trade_ref      text not null,
  mode               text check (mode in ('paper', 'live')),
  venue              text,
  equity             numeric,
  available_balance  numeric,
  used_balance       numeric,
  created_at         timestamp not null default now()
);

create index if not exists idx_balance_snapshots_ref_created
  on balance_snapshots (bot_trade_ref, created_at);

create table if not exists signal_decisions (
  id             uuid primary key default gen_random_uuid(),
  bot_trade_ref  text not null,
  symbol         text not null,
  side           text not null check (side in ('LONG', 'SHORT')),
  decision       text not null check (decision in ('APPROVED', 'REJECTED')),
  reason         text,
  source         text,
  created_at     timestamp not null default now()
);

create index if not exists idx_signal_decisions_ref_created
  on signal_decisions (bot_trade_ref, created_at);

create table if not exists telegram_notifications_sent (
  id          uuid primary key default gen_random_uuid(),
  dedupe_key  text not null unique,
  created_at  timestamp not null default now()
);

create index if not exists idx_telegram_notifications_key
  on telegram_notifications_sent (dedupe_key);
```

## Migração Inicial

Se você já tinha uma tabela `trades` antiga, aplique os ajustes de forma incremental:

```sql
alter table trades add column if not exists bot_trade_ref text;
alter table trades add column if not exists strategy_name text;
alter table trades add column if not exists created_at timestamp not null default now();

create unique index if not exists idx_trades_bot_trade_ref_unique
  on trades (bot_trade_ref)
  where bot_trade_ref is not null;
```

Para tabelas auxiliares ausentes, use o esquema completo. Evite apagar tabelas com histórico sem backup.

## RLS e Políticas

O bot usa conexão PostgreSQL direta pelo backend. O frontend não acessa o Supabase diretamente. Portanto, RLS não é necessária para o fluxo atual.

Recomendações:

- Não exponha anon/service keys no frontend.
- Não crie policies públicas para essas tabelas.
- Restrinja acesso ao banco a credenciais operacionais controladas.

## Exemplos de Validação SQL

Insert mínimo de trade paper:

```sql
insert into trades (
  bot_trade_ref, symbol, side, status, mode, source, venue,
  entry_price, size, leverage
) values (
  gen_random_uuid()::text, 'SOL', 'LONG', 'OPEN', 'paper', 'painel', 'paper',
  150, 100, 5
)
returning *;
```

Fechar o trade de teste:

```sql
update trades
set status = 'CLOSED',
    exit_price = 155,
    realized_pnl = 3.33,
    closed_at = now()
where symbol = 'SOL'
  and venue = 'paper'
  and status = 'OPEN'
returning *;
```

Consultar métricas básicas:

```sql
select mode, count(*) as total, sum(realized_pnl) as pnl
from trades
group by mode;
```

Consultar auditoria por ref:

```sql
select *
from trades
where bot_trade_ref = '<ref>';
```

## Validação pela Aplicação

Testar conexão:

```bash
export SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
node backend/test-supabase/teste.js
```

Testar boot:

```bash
./start.sh
```

Logs esperados:

```
[PERSIST] Pool PostgreSQL criado
[PERSIST] ✓ Conectado ao banco (Supabase PostgreSQL)
```

Testar endpoint:

```bash
curl -sS http://127.0.0.1:3000/api/metrics/summary
```

## Erros Comuns

`SUPABASE_DB_URL detectado no ambiente`

Remova a connection string bruta e use `SUPABASE_DB_URL_PATH`.

`Não foi possível ler SUPABASE_DB_URL_PATH`

Arquivo ausente, path errado ou permissão incorreta.

`relation "trades" does not exist`

Esquema não foi aplicado.

`column "created_at" does not exist`

Esquema antigo. Aplique a migração ou recrie a tabela auxiliar correta.

`password authentication failed`

Connection string, senha ou usuário incorreto.

`connection timeout`

Rede, firewall, pooler ou host incorreto.

## Riscos

- Alto: connection string no `.env` ou commitada.
- Alto: policies públicas ou service role exposta.
- Médio: esquema parcial gera métricas/auditoria incompletas.
- Médio: indisponibilidade do Supabase não bloqueia trading, mas reduz rastreabilidade.
- Baixo: dados paper e live convivem na mesma tabela, separados por `mode`.

## Lista de Verificação Final

- [ ] Projeto Supabase criado
- [ ] Connection string salva apenas em `/opt/bot/secrets/supabase-db-url.txt`
- [ ] `SUPABASE_DB_URL_PATH` configurado no secrets file
- [ ] Esquema completo aplicado
- [ ] `node backend/test-supabase/teste.js` conecta
- [ ] Boot mostra `[PERSIST] ✓ Conectado`
- [ ] Endpoints de métricas respondem

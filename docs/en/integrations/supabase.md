# Supabase / PostgreSQL

## Purpose

Document the Supabase configuration used by the project for external persistence, trade audit, dashboard metrics, and Telegram notification deduplication.

## Audience

Operators, maintainers, and reviewers who need to create, migrate, or validate the database.

## Integration Status

Implemented:

- `pg` as the PostgreSQL client in `backend/src/services/persistenceService.js`
- Lazy connection via `SUPABASE_DB_URL_PATH`
- Best-effort persistence of trades, events, orders, snapshots, decisions, and notifications
- Dashboard endpoints for metrics and audit
- Fail-fast blocking `SUPABASE_DB_URL` raw in the environment

Partially implemented:

- Formal versioned migrations do not exist in the repo; the schema below must be applied manually in the Supabase SQL Editor or an external controlled tool.
- Persistence does not block trading; failures generate logs and incomplete historical data.

Not implemented:

- Supabase REST, anon key, or service role key usage by the bot.
- RLS for direct frontend access; the frontend talks to the backend, not Supabase directly.

## Where it fits

`persistenceService.init()` runs at boot. If `SUPABASE_DB_URL_PATH` is not set, external persistence is disabled and the bot continues.

During operation:

- trade open: inserts into `trades`, `trade_events`, `orders`, `balance_snapshots`, `signal_decisions`
- trade close: updates `trades`, inserts close event and order when `bot_trade_ref` is present
- Telegram notifications: uses `telegram_notifications_sent` to deduplicate alerts across restarts
- dashboard: reads `trades` for metrics and audit tables by `bot_trade_ref`

## Prerequisites

- Supabase account
- Supabase project created
- PostgreSQL password or connection string
- SQL schema applied
- External file with connection string:

```
/opt/bot/secrets/supabase-db-url.txt
```

- Path variable in `/opt/bot/secrets/bot-secrets.env`:

```env
SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
```

## Required vs Optional

Required for trading: nothing from Supabase. The bot operates without it.

Required for external metrics/audit:

- Supabase project
- PostgreSQL connection string in an external file
- `SUPABASE_DB_URL_PATH`
- Tables from the schema below

Not needed today:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`
- RLS for dashboard access

## Secure Secrets Pattern

Do not use:

```env
SUPABASE_DB_URL=postgresql://...
```

The boot process rejects that variable. Use:

```env
SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
```

Create the file:

```bash
sudo mkdir -p /opt/bot/secrets
sudo chown "$USER":"$USER" /opt/bot/secrets
chmod 700 /opt/bot/secrets
printf '%s\n' 'postgresql://postgres.xxxxx:PASSWORD@aws-0-region.pooler.supabase.com:5432/postgres' > /opt/bot/secrets/supabase-db-url.txt
chmod 600 /opt/bot/secrets/supabase-db-url.txt
```

Replace the example with your real connection string. Do not commit this file.

## Create the Supabase Project

1. Open the Supabase dashboard.
2. Create a new project.
3. Choose a region close to your VM.
4. Set a strong database password.
5. Wait for the project to become active.
6. Open `Project Settings` → `Database`.
7. Copy the PostgreSQL connection string. For a VM, prefer the pooler when available.
8. Save the connection string to the external file `supabase-db-url.txt`.
9. Open `SQL Editor` and apply the full schema below.

## Complete SQL Schema

Run this SQL once in the Supabase SQL Editor. It is idempotent for main tables and indexes.

```sql
create extension if not exists pgcrypto;

create table if not exists trades (
  id             uuid primary key default gen_random_uuid(),
  bot_trade_ref  text unique,
  symbol         text not null,
  side           text not null check (side in ('LONG', 'SHORT')),
  status         text not null check (status in ('OPEN', 'CLOSED', 'CANCELLED')),
  mode           text not null check (mode in ('paper', 'live')),
  source         text not null check (source in ('auto', 'telegram', 'dashboard', 'system')),
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

## Initial Migration

If you already had an older `trades` table, apply changes incrementally:

```sql
alter table trades add column if not exists bot_trade_ref text;
alter table trades add column if not exists strategy_name text;
alter table trades add column if not exists created_at timestamp not null default now();

create unique index if not exists idx_trades_bot_trade_ref_unique
  on trades (bot_trade_ref)
  where bot_trade_ref is not null;
```

For missing auxiliary tables, use the full schema above. Avoid deleting tables with historical data without a backup.

## RLS and Policies

The bot uses a direct PostgreSQL connection from the backend. The frontend does not access Supabase directly. RLS is not required for the current flow.

Recommendations:

- Do not expose anon/service keys to the frontend.
- Do not create public policies for these tables.
- Restrict database access to controlled operational credentials.

## Validation SQL Examples

Minimum paper trade insert:

```sql
insert into trades (
  bot_trade_ref, symbol, side, status, mode, source, venue,
  entry_price, size, leverage
) values (
  gen_random_uuid()::text, 'SOL', 'LONG', 'OPEN', 'paper', 'dashboard', 'paper',
  150, 100, 5
)
returning *;
```

Close the test trade:

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

Query basic metrics:

```sql
select mode, count(*) as total, sum(realized_pnl) as pnl
from trades
group by mode;
```

Audit by ref:

```sql
select *
from trades
where bot_trade_ref = '<ref>';
```

## Application Validation

Test connection:

```bash
export SUPABASE_DB_URL_PATH=/opt/bot/secrets/supabase-db-url.txt
node backend/test-supabase/teste.js
```

Test boot:

```bash
./start.sh
```

Expected logs:

```
[PERSIST] Pool PostgreSQL criado
[PERSIST] ✓ Conectado ao banco (Supabase PostgreSQL)
```

Test endpoint:

```bash
curl -sS http://127.0.0.1:3000/api/metrics/summary
```

## Common Errors

`SUPABASE_DB_URL detected in environment`

Remove the raw connection string and use `SUPABASE_DB_URL_PATH`.

`Could not read SUPABASE_DB_URL_PATH`

File missing, wrong path, or incorrect permissions.

`relation "trades" does not exist`

Schema has not been applied.

`column "created_at" does not exist`

Old schema. Apply the migration or recreate the correct auxiliary table.

`password authentication failed`

Wrong connection string, password, or user.

`connection timeout`

Network, firewall, pooler, or wrong host.

## Risks

- High: connection string in `.env` or committed to git.
- High: public policies or exposed service role.
- Medium: partial schema produces incomplete metrics/audit.
- Medium: Supabase unavailability does not block trading but reduces traceability.
- Low: paper and live data coexist in the same table, separated by `mode`.

## Final Checklist

- [ ] Supabase project created
- [ ] Connection string saved only to `/opt/bot/secrets/supabase-db-url.txt`
- [ ] `SUPABASE_DB_URL_PATH` configured in secrets file
- [ ] Full schema applied
- [ ] `node backend/test-supabase/teste.js` connects
- [ ] Boot shows `[PERSIST] ✓ Conectado`
- [ ] Metrics endpoints respond

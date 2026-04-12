# Backends / Venues

The bot is multi-backend. A backend, also called a venue in the code, is the trading integration used for live execution, account snapshots, market limits, and position monitoring.

The active backend is selected at startup:

File: `backend/.env`

```env
PERP_OPEN_VENUE=drift
```

This value is read once when the process starts. To change backend, edit `backend/.env` and restart the bot.

---

## How Backend Selection Works

All execution flows go through `PerpExecutionService`. The service reads the active backend from the venue registry and routes the operation to the matching adapter.

Each backend declares capabilities such as:

- opening and closing trades
- closing all positions
- partial reduce
- TP/SL updates
- balance and account snapshot
- position monitoring
- supported assets, market limits, and max leverage

In live mode, the bot fails fast if the selected backend does not provide the required live capabilities.

---

## Current Registered Backends

| Backend | Intended role | Live readiness in this codebase |
|---------|---------------|----------------------------------|
| `drift` | Solana perps backend | Production-capable |
| `valiant` | Valiant-compatible Hyperliquid API backend | Production-capable, guarded by explicit auto-trading gate |
| `jupiter` | Static metadata / future execution backend | Not live-ready |
| `phoenix` | Static metadata / future execution backend | Not live-ready |

Use the table as a codebase status snapshot, not a recommendation. Always run paper mode and backend-specific preflight before live trading.

---

## Configuration Model

Generic `.env` settings:

File: `backend/.env`

```env
PERP_OPEN_VENUE=drift
PAPER_TRADING=true
```

Raw secrets must never go in `.env`. Use the secrets file and `*_PATH` variables:

File: `/opt/bot/secrets/bot-secrets.env`

```env
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
VALIANT_ACCOUNT_ADDRESS=0xYourPublicAccountAddress
```

Backend-specific non-secret URLs may live in `.env`:

File: `backend/.env`

```env
JUPITER_API_BASE_URL=https://api.jup.ag
PHOENIX_API_BASE_URL=https://api.phoenix.trade
VALIANT_BASE_URL=https://api.hyperliquid.xyz
```

Valiant/Hyperliquid currently uses an agent/API wallet for order signing. `VALIANT_MAIN_KEY_PATH` is only needed when enabling user-signed spot→perps transfer operations.

---

## Paper Mode

Paper mode is backend-aware but does not call live execution adapters. The paper engine intercepts execution while still using backend metadata for risk checks:

- supported assets
- platform leverage caps
- market minimums and step sizes

This lets you test signal parsing, risk checks, dashboard behavior, and manual controls without submitting real orders.

---

## Live Mode Checklist

Before setting `PAPER_TRADING=false`:

- Confirm the selected backend is live-ready in this codebase.
- Configure required wallet/key files outside the repository.
- Use `chmod 600` on all wallet/key/session files.
- Run any backend-specific preflight script available in `backend/scripts/`.
- Start with `POSITION_SIZE_PCT=0.01`.
- Keep global auto-trading off until a small manual live test succeeds.
- Enable backend-specific auto-trading gates only after preflight and manual testing.

Current explicit backend gate:

File: `backend/.env`

```env
ENABLE_AUTO_TRADING_VALIANT=false
```

Valiant/Hyperliquid margin note: spot USDC can be treated as effective backing equity even when perps free collateral is zero. Explicit spot→perps transfer is optional and gated by `ENABLE_VALIANT_AUTO_MARGIN_TRANSFER`.

Valiant/Hyperliquid TP/SL note: TP/SL placement uses native trigger orders with `triggerPx`, a valid aggressive limit price `p`, `grouping: "positionTpsl"`, and normalized wire-format numbers before signing. Operators must verify that trigger orders were accepted by the venue.

---

## Known Limitations

- The active backend is selected at startup and cannot be changed at runtime.
- Same-asset simultaneous positions across multiple backends are not supported yet.
- Position tracking is still effectively keyed by asset in several flows.
- Some broad actions such as `close_all` depend on backend capability and may be refused safely.

---

## Developer Note

To add a new backend incrementally:

1. Create a manifest in `backend/src/venues/manifests/`.
2. Register it in `backend/src/venues/registerBuiltInVenues.js`.
3. Implement execution and monitoring adapters.
4. Add required secrets to `validateEnv.js` using the `*_PATH` pattern.
5. Document only the generic setup plus the minimum backend-specific notes needed to operate safely.

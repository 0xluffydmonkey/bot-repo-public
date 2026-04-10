# Venue Model

The bot uses a multi-venue architecture. The active venue is configured at startup and cannot be changed at runtime.

---

## How venues work

Every trade execution call routes through `PerpExecutionService`, which selects the active venue from the registry and delegates to the appropriate adapter.

The active venue is set by:

```env
PERP_OPEN_VENUE=drift   # drift | jupiter | phoenix
```

This variable is read once at startup. `state.status.activeVenue` shows the resolved venue name — visible in the Telegram status screen and dashboard.

---

## Venue registry

Each venue has a **manifest** declaring its capabilities. Capabilities control which operations the bot is allowed to attempt.

In paper mode, the paper engine intercepts all execution calls — the live adapter is never reached.

---

## Supported venues

### Drift Protocol — `drift`

**Status: Production-ready**

| Capability | Supported |
|-----------|-----------|
| Open trade | ✅ |
| Close trade | ✅ |
| Close all | ✅ |
| Partial reduce | ✅ |
| Update TP/SL | ✅ |
| Balance query | ✅ |
| Account snapshot | ✅ |
| Supported assets | ✅ |
| Market limits | ✅ |
| Platform max leverage | ✅ |
| Position monitoring | ✅ |

**Supported assets:**

| Asset | Market Index |
|-------|-------------|
| SOL | 0 |
| BTC | 1 |
| ETH | 2 |
| APT | 3 |
| 1MBONK / BONK | 4 |
| POL / MATIC | 5 |
| ARB | 6 |
| DOGE | 7 |
| BNB | 8 |
| SUI | 9 |
| WIF | 23 |
| JUP | 24 |

**Wallet:** uses `WALLET_DRIFT_PATH` → falls back to `BOT_WALLET_PATH` if not set.

---

### Jupiter Perpetuals — `jupiter`

**Status: Static metadata only — live execution not implemented**

| Capability | Supported |
|-----------|-----------|
| Supported assets | ✅ (static data) |
| Market limits | ✅ (static data) |
| Platform max leverage | ✅ (static data) |
| Open trade | ❌ Not implemented |
| Close trade | ❌ Not implemented |
| Partial reduce | ❌ Not implemented |
| Update TP/SL | ❌ Not implemented |
| Position monitoring | ❌ Not implemented |

Setting `PERP_OPEN_VENUE=jupiter` will error when the bot attempts live execution. Use `PAPER_TRADING=true` to run paper mode against Jupiter static metadata.

**Supported assets (static):** SOL, BTC, ETH, WIF, BONK, JUP

**Wallet:** `WALLET_JUPITER_PATH` required for live use (not yet implemented).

---

### Phoenix Perps — `phoenix`

**Status: Static metadata only — live execution not implemented**

| Capability | Supported |
|-----------|-----------|
| Supported assets | ✅ (static data) |
| Market limits | ✅ (static data) |
| Platform max leverage | ✅ (static data) |
| All execution | ❌ Not implemented |
| Position monitoring | ❌ Not implemented |

Setting `PERP_OPEN_VENUE=phoenix` will error when the bot attempts live execution.

**Supported assets (static):** SOL, BTC, ETH

**Wallet:** `WALLET_PHOENIX_PATH` required for live use (not yet implemented).

---

## Capability policy in paper mode

In paper mode, the bot only requires **static data capabilities** from the venue:
- `supportsSupportedAssets`
- `supportsMarketLimits`
- `supportsPlatformMaxLeverage`

All execution calls are intercepted by the paper engine before any capability check for execution operations. This means paper mode works with any of the three venues.

---

## Per-venue wallets

Configure in your secrets file (never in `.env`):

```env
WALLET_DRIFT_PATH=/opt/bot/wallets/drift.json
WALLET_JUPITER_PATH=/opt/bot/wallets/jupiter.json
WALLET_PHOENIX_PATH=/opt/bot/wallets/phoenix.json
```

If `WALLET_DRIFT_PATH` is not set, Drift falls back to `BOT_WALLET_PATH`. Jupiter and Phoenix require their own wallet paths when their live execution is enabled.

Each wallet file must have `chmod 600`, owned by the bot user.

---

## Adding a new venue (developer reference)

1. Create a manifest in `backend/src/venues/manifests/` declaring capabilities and adapters
2. Register it in `backend/src/venues/registerBuiltInVenues.js`
3. Implement the execution adapter in `backend/src/trading/adapters/`
4. Implement the monitoring adapter if needed
5. Set `PERP_OPEN_VENUE=<name>` in `.env`

The paper engine handles paper mode automatically — no changes needed in the new venue's adapter.

# Paper Mode

Paper mode is the bot's safe simulation environment. It is the **default mode** and should be used for at least 24 hours before any live deployment.

---

## How to enable

In `backend/.env`:

```env
PAPER_TRADING=true
```

This is a startup-time setting. Paper vs live mode cannot be switched at runtime.

---

## What paper mode does

The bot runs the full signal processing pipeline — Telegram listener, signal parser, deduplication, risk manager — with one difference: instead of calling the live blockchain adapter, all execution calls are intercepted by the **paper engine**.

The paper engine:
- maintains an in-memory paper wallet with a simulated balance (default: `$10,000`, configurable via `PAPER_INITIAL_BALANCE`)
- tracks open positions in memory
- simulates position open, close, partial reduce, and TP/SL updates
- computes mark prices with a small sinusoidal oscillation for visual feedback
- resets on process restart

### What paper mode validates (same as live)

- Signal format and fields
- Asset support for the active venue
- Leverage cap
- R:R ratio minimum
- Free collateral (from paper engine balance)
- Max positions
- Max exposure
- Step size and minimum base amount

### What paper mode does NOT validate

- On-chain transaction success
- Actual market liquidity or slippage
- Real order book or liquidity state for the selected backend
- Fee/gas availability for the selected backend

---

## Paper engine balance

The starting balance is `$10,000` by default. Change it:

```env
PAPER_INITIAL_BALANCE=5000
```

Balance decreases as positions are opened (collateral is consumed) and increases when positions close (collateral + realized PnL is returned).

The balance in the dashboard reflects real paper engine state — it is not static mock data.

---

## Operator surfaces in paper mode

All operator surfaces work identically in paper mode and live mode:
- dashboard shows real paper positions and PnL
- Telegram shows position cards with `🧪 PAPER` label
- manual open, close, reduce, and TP/SL all work
- operational controls (pause, intake, autotrading) all function normally

The `🧪 PAPER` label appears on position open cards, close alerts, PnL milestone alerts, manual trade confirmations, and profit alerts.

---

## Paper mode vs live mode — behavior summary

| Behavior | Paper | Live |
|----------|-------|------|
| Signal intake and parsing | Full pipeline | Full pipeline |
| Risk manager validation | All layers | All layers |
| Live transactions | Simulated in-memory | Real backend orders |
| Balance tracking | Paper engine (in-memory) | Live backend account |
| Position tracking | Paper engine | Live backend state |
| Dashboard shows live data | Yes | Yes |
| Telegram position alerts | Yes, with 🧪 label | Yes |
| Manual trading | Yes | Yes |
| TP/SL update | Yes (simulated) | Backend order when supported |
| Partial reduce | Yes (simulated) | Backend order when supported |
| Live backend connection required | No | Yes |
| State persists after restart | No — resets | Backend is source of truth |

---

## Venue in paper mode

Paper mode is venue-agnostic. The paper engine intercepts all execution calls regardless of which venue is configured via `PERP_OPEN_VENUE`.

However, the bot still uses venue metadata (supported assets, leverage limits, step sizes) for risk validation. This lets paper mode catch many configuration and sizing issues before live trading.

---

## Reconciliation in paper mode

The reconciliation service excludes paper trades from both passes. Paper positions are managed entirely by the in-memory paper engine and are never sent to the DB reconciliation logic.

---

## When to go live

Before switching `PAPER_TRADING=false`:

- [ ] Bot ran for 24+ hours without errors in paper mode
- [ ] Signal detection is working (signals appear in the log)
- [ ] Positions are opening, tracking, and closing correctly in paper mode
- [ ] Telegram position cards appear correctly
- [ ] Operational controls work as expected
- [ ] Risk parameters are tuned to your comfort level
- [ ] Live account is funded with the collateral and fee/gas asset required by the selected backend
- [ ] `POSITION_SIZE_PCT` is set conservatively (recommended: `0.01` = 1%)

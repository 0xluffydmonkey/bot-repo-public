# Live Trading

## Purpose

Document the precautions for operating with real funds using the current implementation.

## Audience

Operators authorized to execute live trading.

## Prerequisites

- `PAPER_TRADING=false`
- Live-ready venue: currently `drift` or `valiant`
- External secrets configured
- Wallet/key via external file
- Manual preflight and small live test completed

## Where it fits

Live trading uses `PerpExecutionService` to route to the active venue adapter. The risk manager runs before execution and enforces limits: `POSITION_SIZE_PCT`, `MAX_LEVERAGE`, `MAX_POSITIONS`, `MIN_FREE_MARGIN_PCT`, `MAX_TOTAL_EXPOSURE_PCT`.

## Base Configuration

In `backend/.env`:

```env
PAPER_TRADING=false
PERP_OPEN_VENUE=drift
POSITION_SIZE_PCT=0.01
MAX_LEVERAGE=5
MAX_POSITIONS=1
MIN_FREE_MARGIN_PCT=0.10
MAX_TOTAL_EXPOSURE_PCT=0.30
MAX_SLIPPAGE_BPS=100
```

For Drift/Solana, in `/opt/bot/secrets/bot-secrets.env`:

```env
SOLANA_RPC_URL=https://your-rpc-provider.example
BOT_WALLET_PATH=/opt/bot/secrets/bot-wallet.json
```

For Valiant/Hyperliquid:

```env
VALIANT_BASE_URL=https://api.hyperliquid.xyz
VALIANT_AGENT_KEY_PATH=/opt/bot/secrets/valiant-agent-key.txt
VALIANT_ACCOUNT_ADDRESS=0xYourPublicAddress
ENABLE_AUTO_TRADING_VALIANT=false
```

If `ENABLE_VALIANT_AUTO_MARGIN_TRANSFER=true`, this is also required:

```env
VALIANT_MAIN_KEY_PATH=/opt/bot/secrets/valiant-main-key.txt
```

## Safe Step-by-Step

1. Run in paper mode for at least one full operational cycle.
2. Confirm logs, Telegram, dashboard, and closes work correctly.
3. Configure live with a low `POSITION_SIZE_PCT`.
4. Confirm venue is live-ready.
5. Run boot and check fail-fast passes with no critical warnings.
6. Open a small manual trade.
7. Close the manual trade and validate balance and state.
8. Only after that consider enabling auto-trading.

## Auto-Trading Gates

There is a global runtime gate: dashboard/control bot toggle `state.status.autoTrading`.

Valiant also has a specific gate:

```env
ENABLE_AUTO_TRADING_VALIANT=false
```

While this flag is not `true`, automatic signals for Valiant are blocked even if the global auto-trading is enabled.

## TP/SL on Valiant/Hyperliquid

TP/SL on Valiant/Hyperliquid uses native trigger orders with `triggerPx`, a valid aggressive limit price `p`, `grouping: "positionTpsl"`, and numbers normalized to wire format before signing. Always verify that trigger orders were accepted by the venue after opening a position. See [close-policy.md](close-policy.md).

## Reconciliation in Live Mode

In live mode, reconciliation is bidirectional:

- DB `OPEN` trades that no longer exist at the active venue are reconciled to `CLOSED`.
- Live positions found at the active venue with no matching DB `OPEN` trade can be adopted as new persisted `OPEN` trades.

Adoption is conservative. The position must be visible for 2 consecutive reconciliation cycles, have a reliable `LONG`/`SHORT` direction, and have no existing `OPEN` trade for the same active `venue + asset`. The adopted trade uses `open_source='venue_reconciliation'`, receives a `bot_trade_ref`, appears in the DB as `OPEN`, and then participates in tracking, alerts, trailing stops, manual/trailing closes, and reconciled external closes.

For Valiant/Hyperliquid, closed trade records can also be enriched with `exit_price` and `realized_pnl` from fill history. Reconciliation currently considers only the active venue per cycle, so do not treat simultaneous multi-venue operation as fully solved. See [../operations/reconciliation.md](../operations/reconciliation.md).

## Risks

- Critical: private key in `.env`.
- Critical: operating live with wrong wallet/key.
- High: enabling auto-trading without a manual close test.
- High: Valiant auto-transfer using agent key instead of main key.
- Medium: external persistence unavailable reduces audit capability.
- Medium: manual venue positions may be adopted with a delay, or not adopted if opened and closed before two reconciliation confirmations.

## Troubleshooting

- Live won't start: check `validateEnv` and required paths.
- Venue not ready: see [venues.md](venues.md).
- Signal ignored: check pause, intake, global auto-trading, and venue gate.
- Balance failure: check free collateral, spot/perps, and risk manager limits.

## Final Checklist

- [ ] `PAPER_TRADING=false` was a conscious decision
- [ ] Wallet/key is stored outside the repo
- [ ] First live test was manual and small
- [ ] Manual close was validated
- [ ] Venue-specific auto-trading gate only enabled after validation

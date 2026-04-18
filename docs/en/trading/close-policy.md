# Close Policy

This document is the canonical source of truth for how the bot resolves venue during close operations.

The policy is intentionally conservative and depends on operational intent. It does not apply the same fallback behavior to every close path.

---

## Venue Resolution Order

When a close flow is allowed to resolve venue dynamically, the order is:

1. Explicit `venue`
2. Tracked position `venue`
3. Active venue fallback

Some flows are allowed to use step 3. Others must fail safe and refuse the close if the venue cannot be resolved from steps 1 or 2.

---

## Policy By Operational Intent

### Manual / local operator flows

These are direct operator-triggered manual helpers.

Rule:

- Active venue fallback is allowed
- If fallback is used, the bot logs a warning

Purpose:

- preserve manual usability
- preserve backward compatibility for direct operator actions

Current implementation:

- `closeManualTrade()` in `backend/src/trading/ManualTradeService.js`
- `closeAllManualTrades()` in `backend/src/trading/ManualTradeService.js`

---

### Remote operator flows

These are human-triggered closes from remote control surfaces such as the dashboard or Telegram control bot.

Rule:

- Prefer explicit venue or tracked position venue
- If the flow routes through shared command-bus / admin paths, it inherits fail-safe behavior
- Active venue fallback is not used in those shared paths

Purpose:

- avoid wrong-venue closes from remote or asynchronous surfaces

Current implementation:

- Dashboard REST and Socket.IO close flows in `backend/src/web/server.js`
- Telegram single-position close callbacks in `backend/src/telegram/handlers/callbacks.js`

Notes:

- Telegram single-position close usually emits `pos.venue` explicitly
- Remote operator flows are intentionally stricter than direct local manual helpers
- Telegram and web dashboard manual closes are always full market exits; on Valiant/Hyperliquid this is implemented as aggressive reduce-only IOC behavior

---

### Admin / system / automated flows

These are closes initiated by orchestration, automation, or internal safety logic.

Rule:

- Active venue fallback is blocked
- If venue cannot be resolved from explicit input or tracked position, the close is refused
- The refusal must be logged clearly

Purpose:

- fail safe instead of guessing

Current implementation:

- `cmd:close` and `cmd:close_all` handlers in `backend/src/index.js`
- trailing/system close in `backend/src/trading/position-management/PositionManager.js`

---

## `close_all` Policy

`close_all` is treated more conservatively than single-position close.

Rules:

- Command-bus, admin, and system `close_all` flows do not use active venue fallback
- Direct manual helper `closeAllManualTrades()` still allows fallback for backward compatibility

Current implementation:

- strict behavior in `backend/src/index.js`
- manual-helper fallback allowed in `backend/src/trading/ManualTradeService.js`
- Telegram `close_all` uses `state.positions[0]?.venue` under the current single-venue-in-practice assumption

---

## Implementation Mapping

### Shared resolver

`backend/src/trading/closeVenueResolver.js`

- canonical resolver for close venue selection
- supports: `explicit`, `position`, `active_fallback`, `unresolved` when fallback is disabled

### Manual helpers

`backend/src/trading/ManualTradeService.js`

- `closeManualTrade()` allows fallback
- `closeAllManualTrades()` allows fallback
- both log when fallback is used

### Command-bus closes

`backend/src/index.js`

- `cmd:close` calls the resolver with `allowActiveFallback: false`
- `cmd:close_all` calls the resolver with `allowActiveFallback: false`

### System trailing close

`backend/src/trading/position-management/PositionManager.js`

- trailing/system close calls the resolver with `allowActiveFallback: false`

### Dashboard

`backend/src/web/server.js`

- REST / Socket close flows resolve venue before emitting command-bus events
- follow the strict command-bus policy

### Telegram control

`backend/src/telegram/handlers/callbacks.js`

- single-position close usually emits explicit `pos.venue`
- `close_all` uses `state.positions[0]?.venue`

---

## Known Limitations

- Tracking is by `asset`, not `asset + venue`
- Simultaneous same-asset multi-venue operation is not supported
- `close_all` reflects the current single-venue-in-practice assumption
- Remote operator flows are stricter than local manual helpers by design

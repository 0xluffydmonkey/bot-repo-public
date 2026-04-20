# Known Gaps and Risks

## Purpose

Register gaps found during the documentation and codebase mapping and classify risks without inventing new architecture.

## Audience

Maintainers, operators, and security reviewers.

## Severity Scale

- Critical: may cause direct fund loss, key/session leak, or unauthorized execution.
- High: may cause incorrect live operation, unauthorized remote control, or significant audit loss.
- Medium: causes operational degradation, poor diagnostics, or confusing behavior.
- Low: limited impact, usually documentation or maintenance.

## Classified Gaps

| Severity | Gap | Status | Current Mitigation |
|----------|-----|--------|-------------------|
| Critical | Any private key, seed, Telegram session, or DB URL raw in `.env` | Control implemented for known variables | `validateEnv`, `*_PATH` docs, partial `scan-secrets.sh` |
| Critical | Prior wallet drain indicates real threat to the environment | Operational context | keep secrets outside repo, permission `600`, review scripts, paper-first |
| High | Remote dashboard without `WEB_API_TOKEN` | Control implemented for critical actions | localhost-only without token; token required for remote |
| High | Control bot with broad authorization | Configurable | use explicit `TELEGRAM_CONTROL_ALLOWED_IDS` |
| High | Live auto-trading on newly configured venue | Partial | Valiant has `ENABLE_AUTO_TRADING_VALIANT` gate; new venues must copy the pattern |
| High | Jupiter/Phoenix registered but not live-ready | Documented in manifest | fail-fast by capabilities; docs mark as partial |
| Medium | Supabase without versioned migrations in the repo | Real gap | full schema documented in `integrations/supabase.md` |
| Medium | Supabase is best-effort and does not block trading | Intentional design | logs and dashboard indicate degradation; do not use as execution source of truth |
| Medium | Paper engine in memory loses state on restart | Intentional behavior | documented in paper/persistence |
| Medium | Multi-venue simultaneous tracking for the same asset has limits | Partial | strict remote close; docs advise one venue at a time in practice |
| Medium | `scripts/scan-secrets.sh` does not cover all blocked raw secrets | Tool gap | use `validateEnv` at boot and human review; expand script in a future change |
| Medium | Reconciliation enrichment (Pass 2) only supports valiant | Known limitation | documented; drift/jupiter/phoenix will leave `exit_price = null` for external closes |
| Medium | Reconciliation/adoption considers only the active venue per cycle | Known limitation | documented in reconciliation/live trading; operate one live venue at a time in practice |
| Low | Old docs in previous structure | Compatibility | new structure replaces them; old files to be removed |

## Important Notes

Supabase is implemented as direct PostgreSQL via `pg`, not via the Supabase SDK. Guides that request `SUPABASE_URL` or anon key would be incorrect for the current state.

Jupiter and Phoenix exist in the code as manifests/adapters, but the manifests declare `liveReady=false`; they must not be treated as ready for live.

Valiant is live-ready, but with an extra gate for automatic auto-trading. Manual live still requires operational care and a small test.

The reconciliation service is bidirectional. It updates stale DB `OPEN` trades to `CLOSED`, enriches `exit_price` where supported, and can create an `OPEN` trade by adopting a live position from the active venue. Adoption is limited to confirmed, unambiguous active-venue positions and uses `open_source='venue_reconciliation'`.

## Recommended Incremental Actions

1. Expand `scripts/scan-secrets.sh` to include `VALIANT_MAIN_KEY` and `SUPABASE_DB_URL`.
2. Add versioned SQL migrations for the Supabase schema.
3. Create an automated checklist that validates Supabase tables.
4. Review the open dashboard read policy if it is exposed outside a private network.
5. Document key rotation procedure per venue.

## Final Checklist

- [ ] Known critical risks are documented
- [ ] Gaps are not masked as completed features
- [ ] Current mitigations point to real controls in the repo
- [ ] Next actions are incremental and low-risk

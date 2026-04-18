# Operational Security

## Purpose

Consolidate practical hardening rules for operating the bot, informed by real risk history.

## Audience

All maintainers and operators.

## Non-Negotiable Rules

- Never store a private key in `.env`.
- Never store a raw Telegram session in `.env`.
- Never commit secrets to git.
- Never add a remote install script without review.
- Never assume generated code is safe.
- Prefer incremental hardening over rewrites.

## Controls Already Implemented

- `validateEnv` blocks known raw secrets.
- `secretFileLoader` loads keys via external path.
- `walletLoader` loads Solana keypair from file.
- `telegramSessionLoader` loads session via path.
- `BOT_SECRETS_FILE` allows secrets outside the repo.
- Dashboard requires token for critical actions when remote.
- systemd has `NoNewPrivileges=true` and `PrivateTmp=true`.
- Supabase uses `SUPABASE_DB_URL_PATH`, not `SUPABASE_DB_URL`.
- Reconciliation never overwrites existing close data.

## Pre-Live Checklist

1. `PAPER_TRADING=true` validated for a full operational period.
2. External secrets with `600` permissions.
3. Correct wallet/key for the venue.
4. Remote dashboard protected by token.
5. Control bot restricted by explicit IDs.
6. First live trade is manual and small.
7. Manual close validated.
8. Auto-trading enabled only after steps 1–7.

## Risks

- Critical: private key exfiltration.
- Critical: leaked Telegram session allows unauthorized read/operation.
- High: dashboard exposed without token.
- High: control bot with broad authorization.
- High: live auto-trading on a newly configured venue.
- Medium: Supabase with excessive permissions.

## Safe Investigation Protocol

When investigating an incident:

- Copy only sanitized logs.
- Do not paste the entire `.env` into external tools.
- Do not paste the Supabase connection string.
- Do not paste private keys, seeds, sessions, or tokens.
- Prefer showing variable names and paths, not values.

## Final Checklist

- [ ] No raw secrets in the repo
- [ ] Absolute paths for sensitive files
- [ ] Permissions reviewed
- [ ] Auto-trading disabled by default on new venues
- [ ] Gaps reviewed in [../operations/gaps-and-risks.md](../operations/gaps-and-risks.md)

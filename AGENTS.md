# Bot Security Hardening Context

## Objective
Improve the security of this existing trading bot incrementally, without rewriting everything.

## Current reality
- Existing bot in production/staging workflow
- .env still used for config
- Secrets must be removed from .env
- Previous wallet drain already happened
- Security is the top priority

## Non-negotiable rules
- Never store private key in .env
- Never commit secrets
- Never add remote install scripts without review
- Never assume generated code is safe
- Prefer incremental hardening over full rewrites

## What assistants should do
- Work with the current codebase
- Propose low-risk, incremental improvements
- Classify risks as critical/high/medium/low
- Focus on practical changes

# RUNBOOK_VM_BOT — Deprecated

This runbook described manual SSH-dependent operation (running the bot attached to a terminal session). That approach was a temporary workaround and is no longer the operational model.

The bot now runs as a persistent systemd service that survives SSH disconnects and restarts automatically on failure.

**The canonical operational guide is:**

[backend/docs/quick-start-vm.md](../../docs/quick-start-vm.md)

It covers: VM setup, secrets, .env, systemd installation, service control, log viewing, updates, and troubleshooting.

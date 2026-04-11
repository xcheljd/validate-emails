# Environment

Environment variables, external dependencies, and setup notes.

**What belongs here:** Required env vars, external API keys/services, dependency quirks, platform-specific notes.
**What does NOT belong here:** Service ports/commands (use `.factory/services.yaml`).

---

## No External Dependencies

This mission does not require:
- External API keys
- Third-party service credentials
- Environment variables

## Proxy Services

Users provide their own SOCKS5 proxy services. The app does not include or recommend specific proxy providers.

## Platform Notes

- macOS development environment
- Tauri desktop app (not web-only)
- Port 1420 used for development server

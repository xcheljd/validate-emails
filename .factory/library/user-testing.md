# User Testing

Testing surface, required testing skills/tools, and resource cost classification per surface.

---

## Validation Surface

| Surface | Tool | Notes |
|---------|------|-------|
| Tauri Desktop App | `agent-browser` | Browser automation via Chrome DevTools Protocol |
| Settings UI | `agent-browser` | Navigate to Settings > Proxy tab |
| Validation Dashboard | `agent-browser` | Main app view for running validations |

### Entry Points

1. **Settings > Proxy Tab** - All proxy configuration happens here
2. **Validation Dashboard** - Where proxy is used during email validation
3. **Failure Modal** - Triggered when all proxies fail

### Key User Flows

1. Add proxy → Enable → Run validation → Verify proxy used
2. Configure multiple proxies → Set rotation mode → Verify rotation
3. Fail all proxies → Verify modal → Test each option (Continue/Retry/Stop)
4. Configure per-domain assignment → Verify correct proxy per email domain

---

## Validation Concurrency

**Machine Profile (from dry run):**
- Tauri app: ~53 MB total (frontend + backend)
- agent-browser instance: ~300 MB per validator

**Max Concurrent Validators: 5**

**Rationale:**
- Lightweight app (53 MB baseline)
- Each validator adds ~300 MB
- 5 validators = ~1.5 GB additional
- Well within headroom for typical development machine

---

## Testing Notes

### Proxy-Dependent Tests
- Full proxy testing requires actual SOCKS5 proxy
- For validation, can mock proxy connections in unit tests
- Integration tests may need to skip proxy-specific assertions if no proxy available

### Known Limitations
- Cannot fully test proxy health without real proxy failures
- Cooldown timing tests may be flaky (time-dependent)
- Per-domain assignment requires emails from multiple providers

---

## Flow Validator Guidance: Settings UI (Proxy Tab)

### Isolation Rules
- **Shared State**: All proxy configuration is stored in global settings (`~/.local/share/com.yourcompany.emailvalidator/settings.json`)
- **Concurrency**: Validators modifying proxy pool state may conflict if run concurrently
- **Recommended**: Run validators sequentially for proxy configuration tests, or use distinct proxy values per validator

### Boundaries
- Each validator should clean up added proxies after testing
- Do not delete proxies you didn't create
- Reset toggle/mode settings to defaults after testing

### Test Data
- Use test proxy addresses like `192.168.1.X:8080` where X varies per validator
- For credentials tests, use `testuserX:testpassX@proxy:port`
- Avoid using real production proxy credentials in tests

### Console Check
- After each action, check browser console for errors
- Report any console errors in the flow report

### Screenshots
- Take screenshots for each assertion as specified in validation-contract.md
- Save to evidence directory: `<missionDir>/evidence/<milestone>/<group-id>/`

---

## Flow Validator Guidance: Validation Dashboard

### Isolation Rules
- Validation uses the current proxy configuration from settings
- Run validation tests only when proxy state is known/controlled
- Do not start actual email validations that could interfere with other validators

### Boundaries
- Only test UI elements, do not perform full validations unless required by assertion
- Mock validation results if needed to test UI behavior

### Test Data
- Use test email addresses like `test@example.com` for UI testing
- Do not validate real email addresses during testing

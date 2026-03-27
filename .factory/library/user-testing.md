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

### Browser Automation Testing Limitations (Round 2 Findings)

**Vite HMR Issue:**
- The development server uses Vite's hot module reload (HMR) which causes frequent page reloads
- This breaks browser automation as refs become invalid and flows are interrupted
- **Workaround**: Disable HMR for testing sessions or use a production build

**Tauri IPC in Browser Context:**
- Running the app at `localhost:1420` without the Tauri desktop wrapper causes `invoke()` calls to fail
- The localStorage fallback in `use-settings.ts` handles CRUD operations correctly
- However, assertions requiring actual backend validation behavior (SMTP with proxy) cannot be tested in browser context
- **Recommendation**: For assertions requiring backend behavior, use Tauri's native testing framework or manual testing with the real desktop app

**Assertions Testable in Browser Context:**
- UI navigation and component rendering
- Toggle state changes (enable/disable proxy)
- Rotation mode selection (UI only)
- Per-domain assignment UI (localStorage CRUD)
- Settings persistence via localStorage

**Assertions Requiring Tauri Desktop App:**
- Actual proxy usage during SMTP validation
- Rotation behavior during validation
- Per-domain fallback during validation
- First-time proxy setup flow (validation step)

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

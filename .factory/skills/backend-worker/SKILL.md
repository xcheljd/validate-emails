---
name: backend-worker
description: Rust/Tauri backend implementation for validation engine features
---

# Backend Worker

NOTE: Startup and cleanup are handled by `worker-base`. This skill defines the WORK PROCEDURE.

## When to Use This Skill

Use for features that require:
- Rust code changes in `src-tauri/src/` (validation.rs, settings.rs, lib.rs, session.rs)
- Tauri command definitions or modifications
- Integration with the `check-if-email-exists` crate
- Backend validation logic (mode differentiation, pipeline changes)

## Required Skills

None. This worker uses Rust toolchain directly.

## Work Procedure

1. **Read existing code thoroughly**:
   - Read all relevant Rust files in `src-tauri/src/`
   - Read `src-tauri/Cargo.toml` for dependencies
   - Understand the `check-if-email-exists` library API by reading the crate source in cargo cache
   - Read `src/lib/types.ts` for the TypeScript interface contract

2. **Write failing tests first** (red):
   - Add test cases in `#[cfg(test)]` module in the relevant Rust file
   - Use `#[tokio::test]` for async tests, `#[test]` for sync
   - Run `cargo test --manifest-path src-tauri/Cargo.toml --lib` to verify tests fail
   - Each test must have a clear name describing what it verifies

3. **Implement to make tests pass** (green):
   - Modify the relevant Rust files
   - If adding Tauri commands, register them in `lib.rs`
   - Keep changes minimal and focused on the feature

4. **Run full verification**:
   - `cargo check --manifest-path src-tauri/Cargo.toml`
   - `cargo test --manifest-path src-tauri/Cargo.toml --lib`
   - `cargo clippy --manifest-path src-tauri/Cargo.toml`
   - `npm run build` (verify TypeScript still compiles with any type changes)

5. **Do NOT modify frontend code** — return to orchestrator if frontend changes are needed.

## Example Handoff

```json
{
  "salientSummary": "Implemented mode differentiation in validation.rs: quick mode skips SMTP (syntax+MX only), standard unchanged, thorough uses 30s timeout + 2 retries. All 8 new tests passing.",
  "whatWasImplemented": "Modified validate_email() in validation.rs to branch on mode string. Quick mode imports check_syntax, check_mx, check_misc directly from check-if-email-exists and skips check_smtp. Thorough mode configures VerifMethodSmtpConfig with 30s timeout and 2 retries. Standard mode unchanged.",
  "whatWasLeftUndone": "",
  "verification": {
    "commandsRun": [
      {"command": "cargo test --manifest-path src-tauri/Cargo.toml --lib", "exitCode": 0, "observation": "All tests passed including 8 new mode tests"},
      {"command": "cargo clippy --manifest-path src-tauri/Cargo.toml", "exitCode": 0, "observation": "No warnings"},
      {"command": "npm run build", "exitCode": 0, "observation": "TypeScript + Vite build succeeded"}
    ],
    "interactiveChecks": []
  },
  "tests": {
    "added": [
      {"file": "src-tauri/src/validation.rs", "cases": [
        {"name": "test_quick_mode_skips_smtp", "verifies": "Quick mode returns without SMTP data"},
        {"name": "test_thorough_mode_higher_timeout", "verifies": "Thorough mode uses 30s timeout"},
        {"name": "test_standard_mode_default_behavior", "verifies": "Standard mode unchanged from current"},
        {"name": "test_mode_stored_in_result", "verifies": "Mode string stored in ValidationResult"}
      ]}
    ]
  },
  "discoveredIssues": []
}
```

## When to Return to Orchestrator

- Feature depends on frontend changes that don't exist yet
- check-if-email-exists library API differs from expected (modules not accessible as expected)
- Cannot integrate without breaking existing validation logic
- Feature requires new Cargo.toml dependencies

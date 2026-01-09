# Plan: Thorough Proxy Implementation Testing

This plan outlines the steps to implement a comprehensive testing suite for the proxy management system, covering unit, state, statistics, integration, and network simulation.

## Phase 1: Environment Setup & Tooling
- [x] Task: Add `mockall` and `wiremock` to `src-tauri/Cargo.toml` as dev-dependencies. da93bcc
- [ ] Task: Create a `tests` directory in `src-tauri/src` or ensure existing test structure is ready for integration tests.
- [ ] Task: Conductor - User Manual Verification 'Environment Setup & Tooling' (Protocol in workflow.md)

## Phase 2: Unit Testing (Rust Logic)
- [ ] Task: Write unit tests for `Proxy::from_str` covering edge cases (invalid IPs, missing protocols, various auth formats).
- [ ] Task: Write unit tests for `ProxyPool::add_proxies` ensuring deduplication and basic addition logic.
- [ ] Task: Write unit tests for `ProxyPool::get_next_proxy` and `get_proxy_excluding` verifying round-robin and exclusion logic.
- [ ] Task: Conductor - User Manual Verification 'Unit Testing (Rust Logic)' (Protocol in workflow.md)

## Phase 3: State & Statistics Testing
- [ ] Task: Implement concurrent tests for `ProxyPool` to verify safety under parallel access.
- [ ] Task: Write tests for `ProxyPool::report_success` and `report_failure` to verify statistics updates.
- [ ] Task: Write tests for `ProxyPool::get_stats` to ensure correct `ProxyPoolStatus` calculation.
- [ ] Task: Conductor - User Manual Verification 'State & Statistics Testing' (Protocol in workflow.md)

## Phase 4: Integration & Network Simulation
- [ ] Task: Use `wiremock` to create a mock proxy server and verify `ProxyPool` can "communicate" through it (simulated).
- [ ] Task: Implement integration tests for Tauri commands (`add_proxies`, `get_proxy_status`, `clear_proxies`) using `tauri::test::mock_builder`.
- [ ] Task: Create a separate utility/test for "Live Connectivity Checks" (ignored by default in CI).
- [ ] Task: Conductor - User Manual Verification 'Integration & Network Simulation' (Protocol in workflow.md)

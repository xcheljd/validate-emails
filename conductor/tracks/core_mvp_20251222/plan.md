# Plan: Core MVP - Bulk Email Validator Desktop App

## Phase 1: Project Scaffolding & Initial Setup [checkpoint: abee29d]
- [x] Task: Initialize Tauri project with React and TypeScript [da1af93]
- [x] Task: Configure Tailwind CSS and Shadcn UI with Dayfox/Nordfox themes [a1d6ebf]
- [x] Task: Set up basic application layout (Sidebar, Content Area) [1627e84]
- [ ] Task: Conductor - User Manual Verification 'Phase 1: Project Scaffolding & Initial Setup' (Protocol in workflow.md)

## Phase 2: Core Validation Engine (Rust Backend) [checkpoint: 6171aa5]
- [x] Task: Write Tests: SMTP and DNS validation logic [3bf0014]
- [x] Task: Implement Feature: Integrate `check-if-email-exists` logic into Tauri commands [3bf0014]
- [x] Task: Write Tests: Concurrency and backoff strategies [3bf0014]
- [x] Task: Implement Feature: Robust bulk validation with progress reporting [3bf0014]
- [ ] Task: Conductor - User Manual Verification 'Phase 2: Core Validation Engine (Rust Backend)' (Protocol in workflow.md)

## Phase 3: Bulk Input & Dashboard UI
- [~] Task: Write Tests: Smart text input parsing logic
- [ ] Task: Implement Feature: Smart text input and CSV upload component
- [ ] Task: Write Tests: Dashboard state management with TanStack Query
- [ ] Task: Implement Feature: Real-time progress bar and status counters
- [ ] Task: Implement Feature: Interactive charts (Safe/Risky/Invalid distribution)
- [ ] Task: Conductor - User Manual Verification 'Phase 3: Bulk Input & Dashboard UI' (Protocol in workflow.md)

## Phase 4: Results Table & Detailed Findings
- [ ] Task: Write Tests: Results table filtering and sorting
- [ ] Task: Implement Feature: Paginated results table with status badges
- [ ] Task: Write Tests: Detailed log view state
- [ ] Task: Implement Feature: Expandable view for technical SMTP logs
- [ ] Task: Conductor - User Manual Verification 'Phase 4: Results Table & Detailed Findings' (Protocol in workflow.md)

## Phase 5: Export & Polishing
- [ ] Task: Write Tests: CSV export logic
- [ ] Task: Implement Feature: Export results to CSV/Excel
- [ ] Task: Task: Final UI/UX polish and theme consistency check
- [ ] Task: Conductor - User Manual Verification 'Phase 5: Export & Polishing' (Protocol in workflow.md)

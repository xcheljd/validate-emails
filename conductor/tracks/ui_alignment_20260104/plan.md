# Plan: UI Alignment & Fixes

## Phase 1: Foundation & Audit

- [x] Task: Audit and Verify Color Palette Configuration 7b70e2d
  - Review `src/index.css` against the Dayfox/Nordfox specifications (conceptually).
  - Ensure all semantic colors (primary, secondary, destructive, etc.) have sufficient contrast in both modes.
  - Create a small "Style Guide" page or component (temporary) to visually verify the palette if needed, or just manually verify.

- [x] Task: Standardize Main Layout Structure 2a90c81
  - Refactor `src/components/layout/main-layout.tsx` to ensure it correctly handles the sidebar and main content area spacing.
  - Ensure `App.tsx` uses `MainLayout` correctly for all views.
  - Fix any scrolling issues (e.g., ensure `ScrollArea` is used where content might overflow).

## Phase 2: Component Polish

- [x] Task: Polish Validation View Components 51063d0
  - Review `EmailInput` for proper focus states and Shadcn integration.
  - Review `ValidationDashboard` (the stats cards) for consistent padding and card styling.
  - Review `ResultsTable` for proper table styling, header pinning, and row density.

- [x] Task: Polish Navigation & Sidebar 2a90c81
- [x] Task: Polish Secondary Views (Settings & History) 657bf5d

## Phase 3: Final Verification

- [x] Task: Implement Theme Provider and Toggle 82d920b
- [x] Task: Implement Settings Persistence 82d920b
- [~] Task: Conductor - User Manual Verification 'UI Alignment' (Protocol in workflow.md)

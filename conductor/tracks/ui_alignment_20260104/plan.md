# Plan: UI Alignment & Fixes

## Phase 1: Foundation & Audit

- [x] Task: Audit and Verify Color Palette Configuration 7b70e2d
  - Review `src/index.css` against the Dayfox/Nordfox specifications (conceptually).
  - Ensure all semantic colors (primary, secondary, destructive, etc.) have sufficient contrast in both modes.
  - Create a small "Style Guide" page or component (temporary) to visually verify the palette if needed, or just manually verify.

- [ ] Task: Standardize Main Layout Structure
  - Refactor `src/components/layout/main-layout.tsx` to ensure it correctly handles the sidebar and main content area spacing.
  - Ensure `App.tsx` uses `MainLayout` correctly for all views.
  - Fix any scrolling issues (e.g., ensure `ScrollArea` is used where content might overflow).

## Phase 2: Component Polish

- [ ] Task: Polish Validation View Components
  - Review `EmailInput` for proper focus states and Shadcn integration.
  - Review `ValidationDashboard` (the stats cards) for consistent padding and card styling.
  - Review `ResultsTable` for proper table styling, header pinning, and row density.

- [ ] Task: Polish Navigation & Sidebar
  - Ensure the `Sidebar` component uses consistent button styles for navigation links.
  - verify active states are clearly visible.

- [ ] Task: Polish Secondary Views (Settings & History)
  - Ensure `SettingsPanel` uses standard Shadcn form components (`Form`, `Label`, `Input`, `Switch`).
  - Ensure `SessionHistory` uses the same table or list styling paradigms as the main view.

## Phase 3: Final Verification

- [ ] Task: Conductor - User Manual Verification 'UI Alignment' (Protocol in workflow.md)

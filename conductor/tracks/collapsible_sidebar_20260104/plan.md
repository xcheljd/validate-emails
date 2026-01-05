# Plan: Collapsible Sidebar

## Phase 1: Implementation

- [ ] Task: Update Settings Store
  - Add `sidebarCollapsed` (boolean) to `AppSettings` in `src/hooks/use-settings.ts`.

- [ ] Task: Implement Collapsible Sidebar UI
  - Update `src/components/layout/sidebar.tsx`:
    - Read `sidebarCollapsed` from `useSettings`.
    - Add toggle button in the header.
    - Conditionally hide labels/text.
    - Adjust width classes (`w-64` vs `w-[70px]`).
    - Ensure `ModeToggle` fits in collapsed state.

## Phase 2: Verification

- [ ] Task: Conductor - User Manual Verification 'Collapsible Sidebar' (Protocol in workflow.md)

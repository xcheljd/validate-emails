# Plan: Collapsible Sidebar

## Phase 1: Implementation

- [x] Task: Update Settings Store 6ddec94
  - Add `sidebarCollapsed` (boolean) to `AppSettings` in `src/hooks/use-settings.ts`.

- [x] Task: Implement Collapsible Sidebar UI 6ddec94
  - Update `src/components/layout/sidebar.tsx`:
    - Read `sidebarCollapsed` from `useSettings`.
    - Add toggle button in the header.
    - Conditionally hide labels/text.
    - Adjust width classes (`w-64` vs `w-[70px]`).
    - Ensure `ModeToggle` fits in collapsed state.

## Phase 2: Verification

- [x] Task: Restore Logo and Brand Name 1627e84
- [x] Task: Conductor - User Manual Verification 'Collapsible Sidebar' (Protocol in workflow.md)

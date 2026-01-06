# Specification: Collapsible Sidebar

## Goal
Make the application sidebar collapsible to maximize the main content area, especially useful for viewing large tables (Results Table).

## Requirements
1.  **Toggle Mechanism:** A button (e.g., ChevronLeft/Right or PanelLeftClose) to toggle the sidebar state.
2.  **Collapsed State:**
    -   Width reduces (e.g., from `w-64` to `w-16` or `w-[70px]`).
    -   Labels are hidden.
    -   Icons remain centered.
    -   "Theme" label hides, toggle remains.
3.  **Persistence:** The collapsed state should persist across sessions (using `localStorage` via `useSettings`).
4.  **Animation:** Smooth transition for width change.

## Implementation Details
-   **Store:** Add `sidebarCollapsed` to `useSettings`.
-   **Component:** Update `Sidebar` to read/write this setting.
-   **Layout:** Update `Sidebar` classes based on state.

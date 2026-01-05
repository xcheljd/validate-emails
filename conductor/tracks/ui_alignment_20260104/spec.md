# Specification: UI Alignment & Fixes

## Goal
To audit and polish the current User Interface (UI) of the desktop application to ensure it strictly adheres to the project's defined Technology Stack and Design Guidelines. This includes consistent use of Shadcn UI components, correct application of the Dayfox (Light) and Nordfox (Dark) color palettes via Tailwind CSS, and a unified, responsive layout structure.

## Context
The project has established a specific "Dayfox" and "Nordfox" aesthetic. The current implementation needs to be verified against these standards. There may be inconsistencies in spacing, component usage, or color application that need to be "fixed" to match the "previous setup" (the intended design).

## Requirements

### 1. Visual Identity Verification
*   **Color Palette:** Verify `src/index.css` correctly implements the Dayfox and Nordfox themes.
*   **Typography:** Ensure consistent font usage and scaling across the app.

### 2. Component Standardization
*   **Shadcn UI:** specific verification that all standard UI elements (Buttons, Inputs, Cards, Dialogs) are using the installed Shadcn components (`src/components/ui/`) rather than raw HTML or custom CSS classes.
*   **Icons:** Ensure `lucide-react` is used consistently.

### 3. Layout Unification
*   **App Shell:** `App.tsx` and `MainLayout` must provide a stable, consistent shell (Sidebar + Main Content Area).
*   **Views:**
    *   **Validation View:** Inputs and Results table.
    *   **Dashboard View:** Charts and Stats.
    *   **History View:** List of past sessions.
    *   **Settings View:** Configuration panels.
*   **Responsiveness:** Ensure the layout breaks down gracefully (though it's a desktop app, it should handle window resizing).

### 4. Specific "Fixes"
*   Review `App.tsx` structure against best practices.
*   Clean up any inline styles or "magic numbers" in Tailwind classes.

## Deliverables
*   Updated `src/index.css` (if palette adjustments are needed).
*   Refactored `App.tsx` and main views to use shared layout components.
*   Consistent "Look and Feel" across all application states.

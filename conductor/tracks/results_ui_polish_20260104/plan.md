# Plan: Results UI Polish & Logic Fixes

## Phase 1: Logic & State Fixes

- [ ] Task: Fix Progress Bar Disappearance
  - Inspect `src/hooks/use-email-validation.ts`.
  - Update `mutation.onSuccess` and `onError` to only set status to 'idle' if the validation is truly complete (not paused).
  - Verify that the 'paused' state correctly prevents the reset.

- [ ] Task: Hardening State Transitions
  - Audit the interaction between the `listen` effect and the manual `status` updates.
  - Ensure 'idle' is only set when `progress === total` or when explicitly stopped/discarded.

## Phase 2: UI Polish

- [ ] Task: Compact Status Grid Refactor
  - Update `src/components/validation/validation-dashboard.tsx`.
  - Consolidate the four cards into a single responsive grid container.
  - Reduce padding and font sizes where appropriate for better density.
  - Implement adaptive layout for thinner windows.

- [ ] Task: Progress UI Polish
  - Ensure the progress bar clearly indicates the 'paused' state (e.g., color change or badge).

## Phase 3: Verification

- [ ] Task: Conductor - User Manual Verification 'Results UI & Workflow' (Protocol in workflow.md)

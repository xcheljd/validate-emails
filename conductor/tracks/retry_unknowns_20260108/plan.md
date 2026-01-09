# Implementation Plan: Post-Validation "Unknown" Retry Mechanism

This plan outlines the steps to implement a targeted retry mechanism for "Unknown" results at the end of a validation session, ensuring different proxies are used for retries.

## Phase 1: Backend Infrastructure for Targeted Retries [checkpoint: 7c393ae]

### Task 1: Extend Backend for Explicit Proxy Exclusion
- [x] Task: TDD - Write unit tests in `src-tauri/src/validation.rs` for a new `validate_email_with_exclusion` function that ensures a different proxy is selected if one is excluded. 0d8acd9
- [x] Task: Implement `validate_email_with_exclusion` and update `ProxyPool` if necessary to support "get next proxy excluding X". 0d8acd9
- [x] Task: Conductor - User Manual Verification 'Backend Infrastructure' (Protocol in workflow.md)

## Phase 2: Frontend State & Logic Enhancements [checkpoint: 281a8d3]

### Task 1: Update `useEmailValidation` Hook for Partial Retries
- [x] Task: TDD - Create `src/hooks/use-email-validation.retry.test.ts` to test a new `retryUnknowns` function. 8cb52dd
- [x] Task: Implement `retryUnknowns` in `use-email-validation.ts`. This function should:
    - Identify emails with "Unknown" status.
    - Preserve their previous proxy info.
    - Call the backend to re-validate them.
    - Update the results state without duplicating entries. 8cb52dd
- [x] Task: Conductor - User Manual Verification 'Hook Logic' (Protocol in workflow.md)

## Phase 3: UI Implementation

### Task 1: Create Retry Prompt Modal
- [ ] Task: TDD - Create `src/components/validation/retry-modal.test.tsx` to verify modal appearance and callback triggers.
- [ ] Task: Implement `RetryModal` component using `shadcn/ui` Dialog.
- [ ] Task: Integrate `RetryModal` into `ValidationDashboard`. Ensure it triggers when `progress === total` AND `unknownCount > 0`.
- [ ] Task: Conductor - User Manual Verification 'UI Implementation' (Protocol in workflow.md)

## Phase 4: Final Verification & Integration

### Task 1: End-to-End Flow Verification
- [ ] Task: Manually verify the full flow: Start validation -> Get Unknowns -> Completion Modal -> Click Retry -> Successful Re-validation with new proxies.
- [ ] Task: Conductor - User Manual Verification 'Final Integration' (Protocol in workflow.md)

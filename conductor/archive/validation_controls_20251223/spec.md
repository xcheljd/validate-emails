# Specification: Validation Progress Controls

## Overview
This track adds the ability for users to control the validation process through Pause, Resume, and Stop actions. This improves user experience by allowing them to manage long-running bulk validation tasks.

## Functional Requirements
1.  **Pause/Resume/Stop Buttons:**
    *   Add controls to the `ValidationDashboard` UI, positioned near the progress bar.
    *   Buttons should be dynamically enabled/disabled based on the current state:
        *   When Validating: Show "Pause" and "Stop".
        *   When Paused: Show "Resume" and "Stop".
        *   When Idle/Finished: Hide or disable these controls.
2.  **Pause Behavior:**
    *   Implement "Immediate Pause" by canceling all currently active validation requests.
    *   When "Resume" is clicked, the system should re-queue the canceled emails and continue the validation process.
3.  **Stop Behavior:**
    *   Halt the entire validation process immediately.
    *   Prompt the user with a confirmation dialog: "Stop validation? You can save the results collected so far or discard them."
    *   If "Save" is chosen, keep the results gathered up to that point.
    *   If "Discard" is chosen, clear the results and reset the dashboard.
4.  **Backend Support (Rust):**
    *   Implement cancellation logic in the Tauri/Rust backend using cancellation tokens or similar mechanisms to ensure network/CPU resources are freed immediately upon pause/stop.
5.  **UI Feedback:**
    *   Update the status indicator in the dashboard to reflect the current state (`Validating`, `Paused`, `Stopping...`, `Stopped`).

## Non-Functional Requirements
*   **Performance:** Cancellation should be near-instant and not leak resources.
*   **Reliability:** Resuming should correctly pick up from where it left off without duplicating results.

## Acceptance Criteria
*   [ ] User can pause validation, and the progress stops immediately.
*   [ ] User can resume validation, and it continues from the last completed email.
*   [ ] User can stop validation and is prompted to save or discard partial results.
*   [ ] Buttons update their visibility/state correctly based on the validation progress status.
*   [ ] Backend validation tasks are truly cancelled (not just ignored by frontend) when paused/stopped.

## Out of Scope
*   Persisting paused states across application restarts (for now).
*   Fine-grained control over individual validation threads (only bulk control).

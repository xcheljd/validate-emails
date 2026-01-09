# Specification: Post-Validation "Unknown" Retry Mechanism

## Overview
This feature introduces a targeted retry mechanism for emails that resulted in an "Unknown" status during a validation session. Upon 100% completion of a validation run, if any "Unknown" results are detected, the user will be prompted to re-validate those specific entries using different proxies to improve deliverability insights.

## Functional Requirements
### 1. Completion Detection & Prompting
- The system must monitor the validation progress.
- Upon reaching 100% completion (progress == total), if the count of "Unknown" results is greater than zero, a modal dialog must appear.
- **Modal Content:**
    - Title: "Validation Complete"
    - Body: "We found {X} Unknown results. Would you like to retry these specific emails using different proxies to improve accuracy?"
    - Actions: [Cancel] [Retry Unknown Emails]

### 2. Retry Logic
- When "Retry Unknown Emails" is selected:
    - The system identifies all emails currently marked as "Unknown".
    - A new internal validation pass is initiated for these emails.
    - The existing results for these emails are temporarily cleared or marked as "Re-validating" to avoid UI confusion.

### 3. Proxy Cycling Strategy
- For each retry attempt, the system MUST attempt to use a proxy different from the one used in the previous attempt for that specific email.
- This requires checking the `proxy_used` field of the previous result and requesting a different node from the `ProxyPool`.

## UI/UX Requirements
- **Modal Dialog:** Should follow the existing `shadcn/ui` style used in the application.
- **Progress Feedback:** The progress bar should reset or show a "Retry Pass" status during the re-validation.

## Acceptance Criteria
- [ ] Modal appears only when a session reaches 100% completion and has >0 "Unknown" results.
- [ ] Clicking "Retry" triggers a new validation run for only the "Unknown" emails.
- [ ] Retried emails use a different proxy than their first attempt (verified via logs/proxy status).
- [ ] Results table updates in real-time as retries complete.

## Out of Scope
- Retrying "Invalid" results (as specified by the user).
- Automatically retrying multiple times (only a single prompt after the first pass).
- Forcing a proxy change if only one proxy is available in the pool.

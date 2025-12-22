# Specification: Core MVP - Bulk Email Validator Desktop App

## Overview
A cross-platform desktop application built with Tauri (Rust/React) that allows users to perform bulk email validation. The app leverages high-performance Rust logic to check email reachability, SMTP status, MX records, and more, presenting findings in a professional dashboard with export capabilities.

## User Stories
* **Sales Rep Bulk Upload:** As a sales rep, I want to upload a CSV of leads so that I can quickly verify which emails are deliverable.
* **Status Summary:** As a user, I want to see a summary of "Safe", "Risky", and "Invalid" emails after a bulk check so I can understand the quality of my list.
* **Technical Deep-Dive:** As a developer/technical user, I want to inspect the technical SMTP logs for an email so I can understand why it failed.

## Functional Requirements
* **Bulk Input:**
    * Support for CSV and Excel file uploads.
    * Smart text area for copy-pasting emails (delimiters: comma, newline).
* **Validation Engine (Rust):**
    * Syntax validation.
    * DNS validation (MX records).
    * SMTP validation (handshake, mailbox existence).
    * Detection of reachability, disabled mailboxes, full inboxes, and catch-all addresses.
    * Automatic concurrency management and backoff strategies.
* **Dashboard & UI:**
    * Real-time progress bar and status counters.
    * Interactive charts for Safe/Risky/Invalid distribution.
    * Paginated results table with filtering and sorting.
    * Expandable rows or side panel for technical SMTP logs.
* **Export:**
    * Export results to CSV/Excel.

## Technical Requirements
* **Framework:** Tauri (Rust backend, React frontend).
* **Frontend Stack:** React, TypeScript, Tailwind CSS, Shadcn UI, Lucide React, TanStack Query.
* **Backend Stack:** Rust, leveraging `check-if-email-exists` logic.
* **Styling:** Dayfox (light) and Nordfox (dark) themes.
* **Persistence:** SQLite (via Tauri plugin) for history (optional for MVP).

## Design Constraints
* Clean, professional aesthetic suitable for business users.
* High legibility for technical logs.
* Responsive desktop layout.

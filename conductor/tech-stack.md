# Technology Stack

## Core Framework
* **Tauri:** For the desktop application shell, providing a lightweight and secure cross-platform environment (Rust backend, Web frontend).

## Frontend
* **React:** The primary UI library.
* **TypeScript:** For type safety across the frontend.
* **Tailwind CSS:** For styling, customized with **Dayfox** and **Nordfox** palettes.
* **Shadcn UI:** For high-quality, accessible UI components.
* **TanStack Query (React Query):** For managing validation requests, caching, and background synchronization.
* **Lucide React:** For consistent and clean iconography.

## Backend (Tauri/Rust)
* **Rust:** For the core application logic and the high-performance email validation engine.
* **Rust Email Validation Library:** We will leverage a high-performance Rust library for SMTP validation, MX record lookup, and syntax checking.

## Data Persistence (Optional/TBD)
* **Local Storage / SQLite:** For persisting previous validation sessions or user settings if needed.

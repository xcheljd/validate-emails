# ValidateEmails

A desktop email validation application built with Tauri (Rust) + React + TypeScript. Validates email addresses using SMTP verification via the `check-if-email-exists` library.

## Features

- **Email Validation** - Verify email deliverability via SMTP, syntax, MX records, and more
- **Bulk Validation** - Validate multiple emails concurrently with progress tracking
- **SOCKS5 Proxy Support** - Route validations through proxy servers with:
  - Single or multiple proxy configuration
  - Automatic weighted rotation (healthier proxies used more)
  - Per-domain proxy assignment (Gmail, Yahoo, Hotmail)
  - Health tracking with success/failure rates
  - Bad proxy detection (3 consecutive failures)
  - Configurable cooldown system (30-300s)
  - Failure handling modal (continue without proxy, retry, or stop)
- **Export** - CSV and Excel export with 22 configurable columns
- **Session Management** - Save, resume, and backup validation sessions
- **Risk Scoring** - Automated risk assessment based on validation results

## Getting Started

### Prerequisites

- Node.js 18+
- Rust (via rustup)
- Tauri CLI

### Install

```bash
npm install
```

### Development

```bash
npm run tauri dev
```

The app runs on port 1420.

### Build

```bash
npm run build        # TypeScript + Vite build
npm run tauri build  # Full production build
```

### Testing

```bash
npm test                    # Run all frontend tests
npx vitest run <path>       # Run single test file
cargo test --manifest-path src-tauri/Cargo.toml --lib  # Run Rust tests
```

## Tech Stack

- **Frontend**: React 19, TypeScript 5.8, Tailwind CSS, Shadcn UI, TanStack Query
- **Backend**: Tauri (Rust) with `check-if-email-exists` SMTP validation engine
- **Testing**: Vitest, @testing-library/react

## Project Structure

```
src/                    # Frontend React app
  components/           # UI components
    settings/           # Proxy settings, general settings
    validation/         # Validation dashboard, results, failure modal
  hooks/                # React hooks (use-email-validation, use-settings)
  lib/                  # Utilities (export, session manager, email parser)
src-tauri/              # Rust backend
  src/
    validation.rs       # Email validation logic with proxy integration
    settings.rs         # Settings, proxy pool, health tracking, cooldown
    lib.rs              # Tauri command registration
    session.rs          # Session persistence
```

## Recommended IDE Setup

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

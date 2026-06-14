# AGENTS.md

## Build/Command Reference
- `npm run dev` - Start dev server on port 1420
- `npm run build` - Type-check and build (tsc && vite build)
- `npm test` - Run all tests with vitest
- `npx vitest run <path>` - Run single test file (e.g., `npx vitest run src/lib/email-parser.test.ts`)
- `npx vitest --reporter=verbose` - Run tests with detailed output

## Tech Stack
- **Frontend**: React 19, TypeScript 5.8, Tailwind CSS, Shadcn UI, TanStack Query, Lucide React
- **Backend**: Tauri (Rust) with SMTP validation engine
- **Themes**: Dayfox (light) and Nordfox (dark) palettes for professional, high-legibility UI

## Code Style Guidelines
- **Variables**: Use `const`/`let`, never `var`. Prefer `const`.
- **Exports**: Use named exports (`export {MyClass};`), avoid default exports.
- **Formatting**: Single quotes for strings, explicit semicolons, `===`/`!==` for comparisons.
- **HTML/CSS**: 2-space indent (no tabs), lowercase only, double quotes for attributes, omit `type` on scripts/styles, use class selectors over IDs, avoid `!important`.
- **Naming**: UpperCamelCase for classes/types/interfaces, lowerCamelCase for variables/functions, CONSTANT_CASE for constants. CSS: hyphen-separated (`.email-input`).
- **Classes**: Use `private` not `#private` fields, `readonly` for immutable properties, omit `public` modifier.
- **Types**: Avoid `any`, prefer specific types or `unknown`. Use `T[]` not `Array<T>` for simple types. Never declare types in JSDoc `@param`/`@return`.
- **Components**: Use `React.forwardRef`, `cn()` for class merging (from `@/lib/utils`), Radix UI primitives.
- **Imports**: Use `@/*` path alias for src imports (e.g., `@/components/ui/button`, `@/lib/utils`).
- **Testing**: vitest with @testing-library/react. Write tests before implementing features. Wrap hooks in `renderHook()` with QueryClientProvider.
- **Comments**: Use `/** */` for docs, `//` for implementation.

## Architectural Guidance (from Mission 2 Scrutiny Reviews)

### Sequential Async Patterns in Validation Hooks
When implementing sequential operations that must await each result before proceeding (e.g., auto-escalation retry), use direct `invoke()` calls instead of React Query mutations. React Query mutations are fire-and-forget with callbacks, while direct `invoke()` allows proper `await` and try/catch error handling. See `src/hooks/use-email-validation.ts` `retryWithEscalation` for reference.

### Rate Limiting Performance Trade-off
The current rate limiting implementation switches from concurrent to strictly sequential processing when rate limiting is active. This is a deliberate v1 trade-off for simplicity. Future workers extending rate limiting should consider token bucket or semaphore approaches to maintain concurrency while respecting rate limits. See `src-tauri/src/validation.rs` rate-limited path.

### Screenshot Strategy for Documentation
When documenting features that require Tauri backend (session persistence, validation execution), use real screenshots for UI-only components and descriptive SVG placeholders for backend-dependent features. Browser-only mode (Vite dev server) cannot execute Tauri commands. See `docs/screenshots/` for Mission 2 examples.

### Browser-Only Mode Testing Limitations
These are testing artifacts, not user-facing bugs:
- SettingsProvider `invoke()` calls hang in browser mode, preventing localStorage fallback on initial load
- Tauri `invoke()` must be mocked via `window.__TAURI_INTERNALS__.invoke()` for session management tests
- SettingsProvider `reEnableProxy` fallback only updates `app-settings` localStorage key, not `proxy-settings`
- Screenshots for backend-dependent features require SVG placeholders

# Vitest Testing Patterns

Patterns discovered while writing and debugging tests in this project.

## vi.hoisted() for Mock Functions Referenced in vi.mock()

When a mock function is referenced inside a `vi.mock()` factory, it must be defined using `vi.hoisted()` rather than `const` at module scope. This is because `vi.mock()` factories are hoisted to the top of the file, executing before regular variable declarations.

**Wrong:**
```typescript
const mockFn = vi.fn();
vi.mock('@/hooks/settings-context', () => ({
  useSettings: mockFn, // ReferenceError: Cannot access mockFn before initialization
}));
```

**Correct:**
```typescript
const { mockFn } = vi.hoisted(() => ({
  mockFn: vi.fn(),
}));
vi.mock('@/hooks/settings-context', () => ({
  useSettings: mockFn, // Works — hoisted alongside vi.mock
}));
```

## Testing Components that Use React Context

When a component uses a Context (e.g., `useSettings()` reading from `SettingsContext`), tests need to wrap the component in the appropriate provider. Two approaches are used:

### Approach A: Real Provider with Mocked Internals
Use the actual Provider component but mock its backend dependencies (e.g., `invoke()`). This tests more of the real component tree.
```typescript
// Mock Tauri invoke
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue({ ... }),
}));

render(
  <SettingsProvider>
    <ComponentUnderTest />
  </SettingsProvider>
);
```

### Approach B: Passthrough Mock Provider
Create a minimal mock provider that returns fixed values. Simpler but less integration coverage.
```typescript
const { mockUseSettings } = vi.hoisted(() => ({
  mockUseSettings: vi.fn(),
}));
mockUseSettings.mockReturnValue({ settings: defaultSettings, ... });

vi.mock('@/hooks/settings-context', () => ({
  useSettings: () => mockUseSettings(),
  SettingsProvider: ({ children }: { children: React.ReactNode }) => children,
}));

render(<ComponentUnderTest />);
```

Choose approach A when you need to test state propagation through the real context. Choose approach B for simpler unit tests where context behavior is not under test.

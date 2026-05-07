# Stack convention: React Native (Expo)

> Graph-searchability: every React Native doc inherits the universal backtick contract from `_graph-searchability.md`. Screen names, hook names, store names, native module names, Expo plugin names, file paths — all in backticks every time, including in headings.

## Module = feature / screen group

Discovery (in priority order):
1. `app/(<group>)/` (expo-router groups) → modules
2. `src/features/<name>/` or `app/<name>/` → modules
3. `screens/<name>/` if flat structure → modules
4. `src/modules/<name>/` → modules
5. Fallback: graphify communities, naming based on the dominant screen / route in each community (e.g. `auth`, `dashboard`, `profile`).

If the project has only `components/`, `hooks/`, `services/` etc. with no domain folders, treat it as community-based and propose names from route groups.

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| screens | `screens.md` | ≥1 screen | `**/screens/**/*.tsx`, `**/*Screen.tsx`, expo-router files in `app/` |
| components | `components.md` | ≥5 components | `**/components/**/*.{tsx,jsx}` |
| hooks | `hooks.md` | ≥3 custom hooks | `**/use*.{ts,tsx}` |
| stores | `stores.md` | ≥1 store/slice | `**/store*.{ts,tsx}`, zustand `create()`, redux slices |
| services | `services.md` | ≥3 API calls | `**/services/*.{ts,tsx}`, `**/api/*.{ts,tsx}` |
| native | `native.md` | uses native modules | imports from `expo-*`, `react-native-*` native, `Platform.OS` checks |
| platform-notes | `platform-notes.md` | ≥3 platform branches | `Platform.OS === 'ios'` or similar |
| navigation | `navigation.md` | one nav file per module | `**/navigation/*.tsx`, route group `_layout.tsx` |
| types | `types.md` | ≥5 exported domain types | `**/types.{ts,tsx}`, `**/*.d.ts` (only when domain-meaningful) |
| utils | folded | always folded into module README | `**/utils/*.{ts,tsx}` |
| flows | `flows.md` | ≥2 hooks coordinate | derived |

## Per-artifact rules

### `screens.md`
- One H3 per screen.
- Per screen: route, what it shows, primary user action, hooks used, services called, what other screens it navigates to.
- For expo-router: each file in `app/` is a route. Document the route path + the screen's purpose.
- For react-navigation: derive routes from `Stack.Screen` declarations.
- Note layout type (`Stack`, `Tabs`, `Drawer`).
- For each screen: data it loads, actions it offers, navigation targets.
- Embed mermaid for non-trivial state machines (e.g. wizard with 5 steps).

### `components.md`
- Don't list every component. Group by purpose:
  - **Layout** (Screen, Section, Container, Header)
  - **Data display** (List, Card, Detail)
  - **Forms** (Input, Select, FormSection)
  - **Feedback** (Alert, Toast, Spinner)
  - **Domain-specific** (InspectionStatusBadge, CustomerCard)
- Document **public** components (used outside this module). Skip internal-only ones.
- For each documented: props, when to use, code ref.
- If the module wraps a UI library (gluestack, NativeBase, tamagui, RN Paper), note which primitives wrap which.

### `hooks.md`
- One H3 per hook.
- Per hook: signature, what it does, when to use, dependencies.
- For data hooks (TanStack Query, SWR, RTK Query): note query key, stale time, refetch triggers, cache invalidations, persistence (AsyncStorage).
- Mermaid sequence for hooks doing complex orchestration.

### `stores.md`
- One H3 per store / slice.
- State shape (TS interface).
- Actions / mutations / setters.
- Selectors (if any).
- Persistence — AsyncStorage, expo-secure-store, MMKV, watermelondb, none. Note which.
- Cross-store dependencies.

### `services.md`
- One H3 per service function.
- Per service: HTTP method + path, request shape, response shape, error handling, retries.
- **Cross-repo link** to backend handler via merged graph (mandatory when graph has the link).
- Note auth handling (token attachment, refresh).
- Document offline behavior: optimistic updates, retry queues, sync logic.
- TanStack Query persistence (AsyncStorage) or zustand persistence — note explicitly.
- Network error handling (toast, retry, fallback).

### `native.md`
- For each native dependency used (camera, location, file system, biometric, push, sensors):
  - Library
  - Purpose
  - Permissions required (iOS Info.plist + Android manifest)
  - Initialization (where, when)
- Push notifications: expo-notifications setup, token storage, foreground/background handling.
- Background tasks (expo-background-fetch, expo-task-manager): registration + cadence.

### `platform-notes.md`
- Each known platform difference:
  - File / function / line
  - iOS behavior
  - Android behavior
  - Why the divergence (if comments explain)

### `navigation.md`
- Per-module navigator: stacks, tabs, params.
- Routes table (path → screen, params).
- Deep linking config (`expo-linking`, `Linking` prefixes).
- Mermaid `graph LR` showing navigation relationships between screens.

### `types.md`
- Only document **domain types** (Order, Customer, etc.) — skip utility types.
- Show the type definition.
- Cross-reference to backend models / web types (consistency check).
- 🟡 if mobile type shape diverges from backend: flag it.

## Patterns to detect

- **Router**: expo-router (file-based) vs react-navigation (declarative). Note once at repo overview.
- **State management**: zustand, jotai, redux-toolkit, mobx, none. Note in stores.md.
- **Data fetching**: TanStack Query, SWR, RTK Query, axios + interceptors, fetch + custom wrapper. Note in services.md.
- **Forms**: react-hook-form, formik, none. Note in cross-cutting/forms.md if used in 3+ modules.
- **Storage**: AsyncStorage, expo-secure-store, MMKV, watermelondb. Note in stores.md.
- **Styling**: StyleSheet, styled-components, nativewind/tailwind, restyle, unistyles. Note once.
- **UI library**: gluestack, NativeBase, tamagui, RN Paper, custom. Note once.
- **OTA updates**: expo-updates configured? Note in deployment.md.
- **Build**: EAS Build, bare workflow, Expo Go only. Note in deployment.md.
- **i18n**: i18next, lingui, expo-localization. Note in cross-cutting/i18n.md.

## Common gotchas

- Reanimated v3+ requires babel plugin order — note if used.
- Native modules require a rebuild (`npx expo prebuild`, `pod install`) — note in how-to/local-dev.md.
- iOS Pods / Android gradle changes require manual sync — note.
- Expo Go vs dev client vs bare — different native module support; note which the project targets.
- `Platform.OS` branching scattered across files — collect them into platform-notes.md, don't inline.
- AsyncStorage is unencrypted — secrets must use expo-secure-store; flag if a token sits in AsyncStorage.
- Hermes vs JSC — note in repo overview if non-default.
- New Architecture (Fabric / TurboModules) opt-in — note in repo overview if enabled.

# Stack convention: React Native (Expo)

Mostly identical to `react.md`. Differences below.

## Module = feature/screen group

Discovery:
1. `app/(<group>)/` (expo-router groups) → modules
2. `src/features/<name>/` or `app/<name>/` → modules
3. `screens/<name>/` if flat structure → modules
4. Otherwise communities

## Canonical artifact files (RN-specific)

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| screens | `screens.md` | ≥1 screen | `**/screens/**/*.tsx`, `**/*Screen.tsx`, expo-router files |
| components | `components.md` | ≥5 | same as react |
| hooks | `hooks.md` | ≥3 | same |
| stores | `stores.md` | same | same |
| services | `services.md` | ≥3 | same |
| native | `native.md` | uses native modules | imports from `expo-*` modules, `react-native-*` native, `Platform.OS` checks |
| platform-notes | `platform-notes.md` | ≥3 platform branches | `Platform.OS === 'ios'` or similar |
| navigation | `navigation.md` | one nav file in module | `**/navigation/*.tsx`, route group `_layout.tsx` |
| types | `types.md` | same | same |

## Per-artifact (RN-specific notes)

### `screens.md`
- For expo-router: each file in `app/` is a route. Document the route + the screen's purpose.
- For react-navigation: derive routes from the `Stack.Screen` declarations.
- Note layout (`Stack`, `Tabs`, `Drawer`).
- For each screen: what data it loads, what actions it offers, what other screens it navigates to.

### `services.md`
- Document offline behavior: optimistic updates, retry queues, sync logic.
- TanStack Query persistence (`AsyncStorage`) or zustand persistence — note.
- Network error handling (toast, retry, fallback).

### `native.md`
- For each native dependency used (camera, location, file system, biometric, push):
  - Library
  - Purpose
  - Permissions required (iOS Info.plist + Android manifest)
  - Initialization (where, when)
- Push notifications: expo-notifications setup, token storage.

### `platform-notes.md`
- Each known platform difference:
  - File / function / line
  - iOS behavior
  - Android behavior
  - Why the divergence (if comments explain)

### `navigation.md`
- Per module navigator: stacks, tabs, params.
- Mermaid: graph LR showing navigation relationships.

## Cross-repo links

Same as react: services.md should link backend handlers via merged graph.

## Patterns to detect

- **Router**: expo-router (file-based), react-navigation (declarative). Note once.
- **Forms**: react-hook-form, formik. Note.
- **State**: same as react.
- **API layer**: axios + interceptors, fetch + custom wrapper, TanStack Query.
- **Storage**: AsyncStorage, expo-secure-store, MMKV, watermelondb. Note in stores.md.
- **OTA updates**: expo-updates configured? Note in deployment.md.
- **Build**: EAS Build, bare workflow, Expo Go only.

## Common gotchas

- Reanimated v3+ requires babel plugin order — note if used.
- Native modules require rebuild — note in how-to/local-dev.md.
- iOS Pods / Android gradle changes require manual sync — note.

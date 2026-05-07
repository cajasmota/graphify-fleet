# Stack convention: Flutter / Dart

## Module = feature folder

Discovery:
1. `lib/features/<name>/` (clean-architecture style)
2. `lib/src/<feature>/`
3. `lib/<feature>/` for flatter layouts
4. Communities fallback

Common architectures: clean (data/domain/presentation per feature), MVVM, plain.

## Canonical artifact files

| Artifact | File | Threshold | Source patterns |
|----------|------|-----------|-----------------|
| screens / pages | `screens.md` | ≥1 screen | `**/screens/*.dart`, `**/pages/*.dart`, `*Screen.dart`, `*Page.dart` |
| widgets | `widgets.md` | ≥5 reusable widgets | `**/widgets/**/*.dart` |
| state / providers | `state.md` | ≥1 provider/cubit/bloc | provider, riverpod, bloc patterns |
| services / repositories | `services.md`, `repositories.md` | ≥1 each | `**/services/*.dart`, `**/repositories/*.dart`, `**/data_sources/*.dart` |
| models | `models.md` | ≥3 domain models | `**/models/*.dart`, `freezed` annotations |
| navigation | `navigation.md` | one router file | `go_router`, `auto_route` config |
| native | `native.md` | platform channels | `MethodChannel` usage |

## Per-artifact rules

### `screens.md`
- Per screen: route, what it shows, state used, services called.
- Navigation transitions in/out.
- Lifecycle hooks (initState, dispose).

### `state.md`
- Stack-dependent: provider, riverpod (StateNotifier, AsyncNotifier, Notifier), bloc (Bloc, Cubit), getx, mobx.
- Per provider/notifier: state shape, methods, dependencies.
- For bloc: events + states.

### `services.md` / `repositories.md`
- Per service: method signatures, error model (Either, Result, exceptions), data source split.
- API HTTP layer: dio/http package, interceptors, retry policies.

### `models.md`
- Freezed-generated models — show the @freezed class, not the generated `.g.dart`.
- JSON serialization: `fromJson`/`toJson` source.
- Equatable / value-equality patterns.

### `navigation.md`
- Routes table (path → screen).
- Guards / redirects.
- Deep linking config.

## Patterns to detect

- **State management**: riverpod (with code-gen), bloc, provider, getx, mobx, redux. Note once.
- **Architecture**: clean (data/domain/presentation), MVVM, plain. Note once.
- **HTTP**: dio, http, retrofit. Interceptors.
- **Storage**: shared_preferences, hive, isar, sqflite, drift, sembast.
- **DI**: get_it, riverpod, manually constructed.
- **Code-gen**: freezed, json_serializable, build_runner, riverpod_generator. Note in repo overview (build commands).
- **Native modules**: platform channels, ffi, plugins.
- **Build flavors**: dev/staging/prod via `--flavor` or `lib/main_<flavor>.dart`.

## Common gotchas

- `BuildContext` async usage — `mounted` checks.
- Hot reload vs hot restart vs full rebuild — note when state machines need full restart.
- Platform-specific code (`Platform.isIOS`, `Platform.isAndroid`).
- iOS-specific config (`Info.plist`, entitlements) and Android (`AndroidManifest.xml`, gradle).
- `pubspec.yaml` version constraints — note any `git:` deps or local paths.

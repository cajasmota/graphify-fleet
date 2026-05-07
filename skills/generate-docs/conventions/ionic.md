# Stack convention: Ionic (Capacitor, Angular/React/Vue)

Ionic 7+ is a UI + native-bridge layer that runs on top of Angular, React, or Vue. The underlying framework's conventions still apply for routing, state, and component decomposition; this file describes only the Ionic-specific overlays (IonPage screens, IonRouterOutlet navigation, Capacitor native bridges, platform divergences).

## Module = feature folder (underlying framework's discovery)

Discovery (priority):
1. **Detect underlying framework** by inspecting `package.json` dependencies:
   - `@ionic/angular` → Angular project; modules are `src/app/<feature>/` directories or `*.module.ts` candidates (per the Angular discovery rules)
   - `@ionic/react` → React project; modules are `src/features/<name>/`, `src/modules/<name>/`, or `src/pages/<name>/` (per the React discovery rules)
   - `@ionic/vue` → Vue project; modules are `src/features/<name>/`, `src/modules/<name>/`, or `src/views/<name>/` (per the Vue discovery rules)
2. Within the chosen framework's discovery, prefer folders that contain `IonPage`-wrapped components as the strongest module-boundary signal.
3. Fallback: graphify communities (auto-detected co-change groupings) when no explicit folder structure exists.

Document the underlying framework once at the top of `index.md` (e.g., "Ionic 7 on Angular 17 standalone components") so the rest of the docs make sense.

## Canonical artifact files

Each module folder's homepage is `index.md` (NOT `README.md`). Below-threshold artifacts fold into `index.md` as a section. Standard framework artifacts (components, hooks/composables/services, stores, models, API services) follow the underlying-framework rules; the table below covers the Ionic-specific overlays added on top.

| Artifact | File | Template | Threshold | Source patterns |
|----------|------|----------|-----------|-----------------|
| screens (IonPage components) | `screens.md` | `output-templates/screens.md` | ≥2 IonPage components | components rendering `<IonPage>`, `<ion-page>`, or `IonPage` JSX/template root |
| navigation | `navigation.md` | `output-templates/cross-cutting.md` | always when ≥1 `IonRouterOutlet`, `IonTabs`, or `IonMenu` | `IonRouterOutlet`, `IonTabs`, `IonTabBar`, `IonMenu`, `useIonRouter`, `IonReactRouter` |
| native bridges | `native.md` | `output-templates/cross-cutting.md` | ≥1 Capacitor plugin import or `Capacitor.*` call | `@capacitor/*` imports, `Capacitor.isNativePlatform()`, `registerPlugin` |
| platform notes | `platform-notes.md` | `output-templates/cross-cutting.md` | ≥1 platform branch | `Platform.is(...)`, `isPlatform(...)`, `mode="md"`/`mode="ios"` overrides, `process.env.CAPACITOR_PLATFORM` |
| UI patterns | `ui-patterns.md` | `output-templates/cross-cutting.md` | ≥5 distinct Ion components used module-wide | `@ionic/<framework>` imports (`IonList`, `IonItem`, `IonModal`, `IonToast`, `IonAlert`, `IonActionSheet`, etc.) |
| API services | `services.md` (Swagger-card sections) | `output-templates/api-class.md` | per underlying framework | per underlying framework |

## Per-artifact rules

### `screens.md`
- One H3 per IonPage component.
- Per screen:
  - Confirm it wraps content in `IonPage` and has an `IonHeader` + `IonContent` (the standard Ionic shell); flag pages that omit `IonPage` since they break navigation transitions.
  - Route path (from underlying framework's router config) and how the screen is reached (tab, stack push, modal, side menu).
  - Ionic lifecycle hooks used: `ionViewWillEnter`, `ionViewDidEnter`, `ionViewWillLeave`, `ionViewDidLeave`. Note that in React these are `useIonViewWillEnter`/etc. hooks; in Angular they are component methods; in Vue they are lifecycle imports from `@ionic/vue`.
  - Per-page navigation behavior: animations (`animated`, `animation`), `swipeBackEnabled`, modal vs full-page presentation.
  - Pull-to-refresh (`IonRefresher`), infinite scroll (`IonInfiniteScroll`), keyboard handling (`Keyboard` plugin), if used.
- "How it works" prose for orchestration is PLAIN PROSE — never annotated code blocks.

### `navigation.md`
- Top-level navigation shape: tab navigation (`IonTabs` + `IonTabBar` + `IonRouterOutlet` per tab), single stack (`IonRouterOutlet` only), side menu (`IonMenu` + `IonSplitPane`), or hybrid (tabs + side menu + per-tab stacks).
- Per-stack: which IonPages live in the stack, push/pop entry points.
- Programmatic navigation API used:
  - React: `useIonRouter()` (Ionic-aware, preserves stack and animations) vs `useHistory()` from react-router (works but loses Ionic transition semantics).
  - Angular: `NavController` (Ionic-aware push/pop/back) vs raw `Router.navigate()`.
  - Vue: `useIonRouter()` vs `vue-router`'s `useRouter()`.
- Deep linking: URL scheme + Universal Links (iOS) / App Links (Android) declared in `capacitor.config.ts` (`appUrlOpen`), `Info.plist` (`CFBundleURLTypes`, associated domains), and `AndroidManifest.xml` (`<intent-filter>` with `BROWSABLE`).
- Modals and overlays as navigation: `IonModal` (sheet vs full-screen, breakpoints), `IonPopover`, `IonActionSheet` — note when these are used in place of routed pages.
- Back-button handling: hardware back on Android (`App.addListener('backButton', ...)` from `@capacitor/app`), web browser back, gesture swipe-back on iOS.

### `native.md`
- One H3 per Capacitor plugin in use. Common plugins to surface:
  - `@capacitor/camera` (photos, camera roll permissions)
  - `@capacitor/geolocation` (location permissions, accuracy)
  - `@capacitor/push-notifications` and `@capacitor/local-notifications`
  - `@capacitor/filesystem` (directory choice: `Directory.Data`, `Directory.Cache`, `Directory.External`)
  - `@capacitor/preferences` (key-value storage)
  - `@capacitor/network`, `@capacitor/app`, `@capacitor/device`, `@capacitor/share`, `@capacitor/haptics`, `@capacitor/status-bar`, `@capacitor/splash-screen`, `@capacitor/keyboard`
  - Custom plugins (`registerPlugin<T>('Name')`) — point to the `ios/` and `android/` plugin sources.
- Per plugin: methods called, where called from, permission prompts triggered.
- Web-fallback behavior: which methods work in the web build (`Capacitor.isNativePlatform()` checks), which throw, which silently no-op.
- Required platform configuration:
  - iOS `Info.plist` keys (`NSCameraUsageDescription`, `NSLocationWhenInUseUsageDescription`, `NSPhotoLibraryUsageDescription`, etc.).
  - Android `AndroidManifest.xml` permissions and features (`ACCESS_FINE_LOCATION`, `CAMERA`, `POST_NOTIFICATIONS` on Android 13+).
  - Capabilities/entitlements (push notifications, associated domains, background modes).

### `platform-notes.md`
- iOS vs Android vs web divergences observed in the codebase: code branches on `Platform.is('ios')`, `Platform.is('android')`, `Platform.is('hybrid')`, `Platform.is('capacitor')`, `Platform.is('mobileweb')`.
- `mode` prop overrides forcing Material Design (`mode="md"`) or iOS look (`mode="ios"`) on specific components.
- Safe-area inset handling (CSS env vars `--ion-safe-area-top`, etc.; status-bar overlay configuration).
- Platform-specific assets (splash screens, app icons, adaptive icons on Android).
- Platform-specific build steps or flavors.

### `ui-patterns.md`
- Catalog of Ion components used in the module grouped by purpose:
  - **Layout**: `IonPage`, `IonHeader`, `IonContent`, `IonFooter`, `IonGrid`/`IonRow`/`IonCol`, `IonSplitPane`.
  - **Lists & data**: `IonList`, `IonItem`, `IonItemSliding`, `IonReorder`, `IonVirtualScroll`/`@ionic/react` virtuoso wrappers.
  - **Forms**: `IonInput`, `IonTextarea`, `IonSelect`, `IonCheckbox`, `IonRadio`, `IonToggle`, `IonRange`, `IonDatetime`.
  - **Overlays**: `IonModal`, `IonPopover`, `IonAlert`, `IonActionSheet`, `IonToast`, `IonLoading`, `IonPicker`.
  - **Feedback**: `IonSpinner`, `IonSkeletonText`, `IonProgressBar`, `IonBadge`, `IonChip`.
- Note which custom components in `components.md` wrap which Ion primitive (e.g., `<AppPrimaryButton>` wraps `IonButton` with brand styling).
- Theming: CSS variables overridden in `src/theme/variables.css` (color palette, primary/secondary/tertiary), per-mode overrides (`:root.md { ... }` vs `:root.ios { ... }`).

## Patterns to detect

- **Underlying framework**: `@ionic/angular` vs `@ionic/react` vs `@ionic/vue`. Note version (Ionic 7+, Ionic 8) at repo overview.
- **Native runtime**: Capacitor (current; `capacitor.config.ts`, `npx cap` CLI) vs Cordova (legacy; `config.xml`, `cordova-*` plugins). Capacitor is the supported direction; flag any Cordova-only plugins still in use.
- **Capacitor config**: `capacitor.config.ts` (or `.json`) — `appId`, `appName`, `webDir`, `server.url` (live reload target), plugin-specific config blocks.
- **Routing wrapper**: `IonReactRouter` (React, wraps react-router) vs Angular's `RouterModule` with `IonRouterOutlet` vs `@ionic/vue-router` integration.
- **Ion icons**: `ionicons` package usage — tree-shaken named imports vs `<ion-icon name="...">` string lookups (string lookups bundle the full set unless `addIcons({...})` is configured).
- **Theming**: CSS variables in `src/theme/variables.css`, dark-mode (`@media (prefers-color-scheme: dark)` or `.dark` class strategy), per-mode (`md`/`ios`) overrides.
- **UI runtime**: Stencil-based web components (Ionic core ships as Stencil) — note any custom Stencil components built alongside.
- **Live reload**: `capacitor.config.ts`'s `server.url` pointing to a dev host (e.g., `http://192.168.1.x:5173`); `cleartext: true` for HTTP in dev.
- **State, forms, data fetching**: per the underlying framework's patterns — repeat the detection there, don't duplicate Ionic-side.

## Common gotchas

- **Live reload requires `capacitor.config.ts` `server.url`**: pointing at the dev server is what makes a native build hot-reload web changes. Forgetting `cleartext: true` for HTTP dev URLs causes silent blank screens on Android.
- **Plugin sync after install**: every `npm install @capacitor/<plugin>` (or web bundle change) needs `npx cap sync` (or `npx cap copy` for fast web-only updates) before the next native build, or the native projects won't see the new plugin / new `capacitor.config.ts`.
- **Status-bar overlay handling**: by default the status bar overlays the WebView on Android (and on iOS with `UIViewControllerBasedStatusBarAppearance` set); content can render under it. Use `StatusBar.setOverlaysWebView({ overlay: false })` and/or CSS safe-area padding.
- **iOS safe-area insets**: notch/home-indicator areas are not auto-padded by the WebView. Use `padding: env(safe-area-inset-*)` or Ionic's built-in `--ion-safe-area-*` variables; `IonHeader`/`IonContent` handle this automatically — naked `<div>` roots do not.
- **Hardware back button on Android**: nothing handles it for free in single-stack apps. Subscribe via `App.addListener('backButton', ...)` from `@capacitor/app`, or in Angular use `Platform.backButton.subscribeWithPriority(...)`. Without this the app exits on back.
- **Web build vs native build plugin availability**: `Capacitor.isNativePlatform()` (or per-plugin web shims) must guard plugin calls that have no web implementation (e.g., `PushNotifications.register()` throws on web). Calling unguarded leads to runtime errors only on the web build.
- **`IonPage` is required for navigation transitions**: a routed component without an `IonPage` root won't animate or stack correctly — it will appear without a transition and may cause `IonRouterOutlet` to discard it from the stack.
- **`IonModal` and React lifecycle**: presenting controllers (`useIonModal`, `useIonAlert`) detach from the React tree — context providers above the page don't reach the modal contents unless you wrap the modal's component yourself.
- **Ion lifecycle vs framework lifecycle**: `ionViewWillEnter` fires every time the page is navigated to (including back-navigation reuse), while React's `useEffect` / Vue's `onMounted` / Angular's `ngOnInit` fire only on first mount. Use the Ion hooks for "refresh on each visit" logic.
- **Icon registration in production**: `<ion-icon name="trash">` works in dev (auto-fetch) but breaks in production builds with strict CSP or when the icons are not bundled — use `addIcons({ trash })` from `ionicons/icons` at app start.
- **Capacitor 5+ Android Gradle / iOS Pod versions**: native dependency upgrades require matching `android/variables.gradle` (minSdk, compileSdk) and a fresh `pod install` in `ios/App`. Note the required toolchain versions in the repo overview.
- **`mode` mismatch**: Ionic auto-picks `ios` mode on iOS and `md` on Android; forcing one globally (`setupIonicReact({ mode: 'md' })` or `IonicModule.forRoot({ mode: 'md' })`) makes the app look identical on both — note the choice explicitly.

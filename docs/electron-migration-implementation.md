# Electron Desktop App Migration - Project Tracker

**Project**: Migrate Convex-DB web app to native macOS Electron desktop app
**Owner**: Milad
**Started**: 2025-12-02
**Status**: Planning Complete ✅

---

## 🎯 Project Overview

### Goal
Migrate the Convex-DB task management web application to a native macOS Electron desktop app using BrowserView API for embedded sites (Gmail, Messages, Wikipedia). This solves iframe embedding restrictions (X-Frame-Options blocking) and enables deep macOS integration with system tray, global keyboard shortcuts, and native notifications. The app will be Electron-only (deprecate web version) to simplify architecture and provide the best desktop experience.

### Success Criteria
- [ ] Gmail, Messages, and Wikipedia load without X-Frame-Options restrictions in BrowserView
- [ ] All existing task management features work identically in Electron
- [ ] System tray icon with menu (Show App, Quick Add, Quit)
- [ ] Global keyboard shortcuts work system-wide (Cmd+Shift+Space for quick add)
- [ ] Native macOS notifications for task alerts
- [ ] Convex WebSocket connection works unchanged
- [ ] All validation passes: `bun run typecheck && bun run lint && bun test`
- [ ] DMG installer builds successfully and installs on macOS
- [ ] Dev mode has hot reload for renderer, auto-restart for main process
- [ ] Window state persists (size, position) across restarts
- [ ] BrowserView sessions persist (stay logged into Gmail/Messages)

---

## 📋 Implementation Milestones

### **Milestone 1: Project Setup & Configuration**
**Goal**: Install Electron dependencies, configure build tools, and create directory structure for Electron-specific code

**Tasks**:
- [ ] Install Electron dependencies: `bun add -D electron electron-builder electron-vite electron-store electron-updater`
- [ ] Create directory structure: `mkdir -p electron/main electron/preload electron/resources`
- [ ] Create `app/electron.vite.config.ts` with main/preload/renderer configurations
- [ ] Create `electron-builder.json` with macOS DMG packaging configuration
- [ ] Create `.env.electron` with Convex URL environment variable
- [ ] Update root `package.json` with Electron scripts (electron:dev, electron:build, electron:dist)
- [ ] Test that Electron installs correctly: `bunx electron --version`

**Success Criteria**:
- ✅ All Electron dependencies installed and in package.json devDependencies
- ✅ Directory structure created with electron/main, electron/preload, electron/resources folders
- ✅ `bun run electron:dev` command is available (will fail at this stage, that's expected)
- ✅ Typecheck passes: `bun run typecheck`
- ✅ User can verify: `ls electron/` shows correct structure

**Completion Notes**:
```
Date:
Status:

Notes:
- Installed Electron v[version] and related build tools
- Created [X] configuration files
- Set up [specific structure decisions]

Test Results:
- ✅ Dependencies installed: [list versions]
- ✅ Directory structure verified
- ✅ Typecheck: [result]

Issues encountered:
-

Next steps:
- Milestone 2: Implement main process core (window, tray, shortcuts)
- Start with electron/main/main.ts as entry point
```

---

### **Milestone 2: Main Process Core (Window, Tray, Shortcuts)**
**Goal**: Implement main process entry point, window management, system tray, and global keyboard shortcuts

**Tasks**:
- [ ] Create `electron/main/main.ts` - main process entry point with app lifecycle
- [ ] Create `electron/main/window.ts` - window creation with macOS native title bar
- [ ] Create `electron/main/tray.ts` - system tray integration with menu
- [ ] Create `electron/main/shortcuts.ts` - global keyboard shortcuts registration
- [ ] Add window state management (hide to tray on close, macOS behavior)
- [ ] Add theme change listener (sync with macOS system theme)
- [ ] Test app launches: `bun run electron:dev` (will show blank window, that's expected)

**Success Criteria**:
- ✅ Electron app launches and shows window (blank at this stage is OK)
- ✅ Window has native macOS title bar with traffic light buttons
- ✅ System tray icon appears (may need placeholder icon)
- ✅ Tray menu shows: Show App, Quick Add Task, Inbox, Priority Queue, Quit
- ✅ Global shortcuts registered (won't work yet without renderer, that's OK)
- ✅ Window hides to tray on close (macOS behavior)
- ✅ Typecheck passes: `bun run typecheck`
- ✅ User can verify: Window appears, tray icon shows, clicking tray shows window

**Completion Notes**:
```
Date:
Status:

Notes:
- Created [X] main process files following Electron best practices
- Window configured with [specific settings]
- Tray menu includes [menu items]
- Registered [X] global shortcuts

Test Results:
- ✅ App launches: [result]
- ✅ Tray icon appears: [yes/no]
- ✅ Window management: [hide/show behavior]
- ✅ Typecheck: [result]

Files Created (4):
- electron/main/main.ts ([X] lines) - Main process entry point
- electron/main/window.ts ([X] lines) - Window creation and management
- electron/main/tray.ts ([X] lines) - System tray integration
- electron/main/shortcuts.ts ([X] lines) - Global keyboard shortcuts

Issues encountered:
- [Any issues with Electron APIs or macOS-specific behavior]

Next steps:
- Milestone 3: Implement BrowserView manager for Gmail, Messages, Wikipedia
- Create browserview.ts following BrowserView API pattern
- Pre-create views with persistent sessions
```

---

### **Milestone 3: BrowserView Manager (Key Feature)**
**Goal**: Implement BrowserView manager class to handle Gmail, Messages, and Wikipedia views with persistent sessions

**Tasks**:
- [ ] Create `electron/main/browserview.ts` - BrowserViewManager class
- [ ] Implement `initializeViews()` - pre-create Gmail, Messages, Wikipedia BrowserViews
- [ ] Implement `createView()` - create BrowserView with persistent session partition
- [ ] Implement `switchView()` - show/hide BrowserViews and handle URL navigation
- [ ] Implement `hideAllViews()` - remove all BrowserViews from window
- [ ] Implement `resizeView()` - auto-resize BrowserView to fill window
- [ ] Add navigation handler - log URL changes for debugging
- [ ] Add window open handler - open links in default browser
- [ ] Update `electron/main/main.ts` to initialize BrowserViewManager
- [ ] Add IPC handlers for `switch-view` and `hide-all-views` in main.ts
- [ ] Test: Manually trigger view switching via Electron dev console

**Success Criteria**:
- ✅ BrowserViewManager instantiates with 3 pre-created views (Gmail, Messages, Wikipedia)
- ✅ Can manually trigger view switching via dev console: `ipcRenderer.invoke('switch-view', 'gmail', 'https://mail.google.com')`
- ✅ Gmail loads without X-Frame-Options errors (this is the critical test!)
- ✅ Messages loads without restrictions
- ✅ Wikipedia loads successfully
- ✅ Views resize automatically when window is resized
- ✅ External links open in default browser
- ✅ Typecheck passes: `bun run typecheck`
- ✅ User can verify: Open dev console, run IPC commands, see Gmail/Messages/Wikipedia load

**Completion Notes**:
```
Date:
Status:

Notes:
- Created BrowserViewManager with [X] methods
- Pre-creates [3] views with persistent sessions (persist:gmail, persist:messages, persist:wikipedia)
- Auto-resize behavior: [implementation details]
- External link handling: [how it works]

Test Results:
- ✅ Gmail loads: [success - no X-Frame-Options block!]
- ✅ Messages loads: [result]
- ✅ Wikipedia loads: [result]
- ✅ View switching: [manual test via dev console]
- ✅ Session persistence: [cookies persist across restarts]
- ✅ Typecheck: [result]

Files Created (1):
- electron/main/browserview.ts ([X] lines) - BrowserView manager class

Files Modified (1):
- electron/main/main.ts (Added BrowserViewManager initialization and IPC handlers)

Issues encountered:
- [Any BrowserView API gotchas or session management issues]

Next steps:
- Milestone 4: Create IPC bridge (preload script + IPC handlers)
- Expose safe APIs to renderer process
- Create type-safe IPC client for renderer
```

---

### **Milestone 4: IPC Bridge (Preload Script + IPC Handlers)**
**Goal**: Create preload script to expose safe Electron APIs to renderer, and implement IPC handlers for storage and notifications

**Tasks**:
- [ ] Create `electron/preload/preload.ts` - exposes electronAPI to renderer via contextBridge
- [ ] Expose platform detection: `platform`, `isElectron`
- [ ] Expose view management: `switchView()`, `hideAllViews()`
- [ ] Expose storage: `store.get()`, `store.set()`, `store.delete()`
- [ ] Expose notifications: `showNotification()`
- [ ] Expose IPC listeners: `on()` with unsubscribe return
- [ ] Add TypeScript definitions for window.electronAPI
- [ ] Create `electron/main/notifications.ts` - native notification manager
- [ ] Create `electron/main/ipc/index.ts` - IPC handlers for storage and notifications
- [ ] Update `electron/main/main.ts` to call `setupIpcHandlers(viewManager)`
- [ ] Test: Access `window.electronAPI` from dev console

**Success Criteria**:
- ✅ `window.electronAPI` is available in renderer dev console
- ✅ Can call `window.electronAPI.switchView('gmail', 'https://mail.google.com')` from console
- ✅ Can call `window.electronAPI.store.set('test', 'value')` and verify persistence
- ✅ Can call `window.electronAPI.showNotification({ title: 'Test', body: 'Hello' })` and see native notification
- ✅ TypeScript recognizes `window.electronAPI` type
- ✅ Typecheck passes: `bun run typecheck`
- ✅ User can verify: Open dev console, test all electronAPI methods

**Completion Notes**:
```
Date:
Status:

Notes:
- Created preload script with contextBridge exposing [X] APIs
- Implemented electron-store for persistent storage
- Native notifications using Electron Notification API
- IPC handlers for [list handlers]

Test Results:
- ✅ electronAPI available: [confirmed in dev console]
- ✅ View switching works via API: [result]
- ✅ Storage persistence: [set/get test results]
- ✅ Notifications appear: [native macOS notification shown]
- ✅ TypeScript types: [window.electronAPI recognized]
- ✅ Typecheck: [result]

Files Created (3):
- electron/preload/preload.ts ([X] lines) - Preload script with contextBridge
- electron/main/notifications.ts ([X] lines) - Native notification manager
- electron/main/ipc/index.ts ([X] lines) - IPC handlers

Files Modified (1):
- electron/main/main.ts (Added setupIpcHandlers call)

Issues encountered:
- [Any context isolation or security issues]

Next steps:
- Milestone 5: Renderer integration (API detection, ElectronBrowserView component)
- Create lib/electron/api.ts for Electron detection
- Create ElectronBrowserView component to control BrowserViews from React
```

---

### **Milestone 5: Renderer Integration (API Detection + ElectronBrowserView Component)**
**Goal**: Add Electron API detection to React app and create ElectronBrowserView component to control BrowserViews from React

**Tasks**:
- [ ] Create `app/src/lib/electron/api.ts` - Electron detection utilities (`isElectron()`, `electronAPI`)
- [ ] Create `app/src/components/ElectronBrowserView.tsx` - React component to control BrowserView
- [ ] Implement useEffect to call `electronAPI.switchView()` when component mounts
- [ ] Implement cleanup to call `electronAPI.hideAllViews()` when component unmounts
- [ ] Add toolbar with refresh and "open in browser" buttons (same as IframeView)
- [ ] Add loading state management
- [ ] Create `app/src/hooks/useElectronStorage.ts` - hook for electron-store (pure Electron, throws error if not in Electron context)
- [ ] Test: Manually render ElectronBrowserView in Layout.tsx to verify it controls BrowserView

**Success Criteria**:
- ✅ `isElectron()` returns true when running in Electron dev mode
- ✅ ElectronBrowserView component mounts and calls `electronAPI.switchView()` successfully
- ✅ Gmail loads in BrowserView when ElectronBrowserView renders
- ✅ Toolbar buttons (refresh, open in browser) work correctly
- ✅ Loading spinner shows while BrowserView loads
- ✅ Component cleanup hides BrowserView on unmount
- ✅ useElectronStorage hook works for persistent storage
- ✅ Typecheck passes: `bun run typecheck`
- ✅ User can verify: See Gmail/Messages/Wikipedia render when component is manually added to Layout

**Completion Notes**:
```
Date:
Status:

Notes:
- Created Electron detection utilities following [pattern]
- ElectronBrowserView controls BrowserView via IPC from React
- Cleanup pattern: [how unmounting works]
- useElectronStorage throws clear errors if not in Electron context (Electron-only architecture)

Test Results:
- ✅ isElectron() returns true: [confirmed]
- ✅ ElectronBrowserView renders Gmail: [success]
- ✅ Toolbar buttons functional: [refresh, open in browser work]
- ✅ Loading state: [spinner shows correctly]
- ✅ Cleanup: [BrowserView hides on unmount]
- ✅ Storage hook: [tested with electron-store]
- ✅ Typecheck: [result]

Files Created (3):
- app/src/lib/electron/api.ts ([X] lines) - Electron detection utilities
- app/src/components/ElectronBrowserView.tsx ([X] lines) - BrowserView control component
- app/src/hooks/useElectronStorage.ts ([X] lines) - Electron-aware storage hook

Issues encountered:
- [Any React/Electron integration gotchas]

Next steps:
- Milestone 6: Update Layout.tsx and view system to use ElectronBrowserView
- Remove IframeView.tsx (Electron-only, no fallback)
- Update Layout.tsx to render ElectronBrowserView for iframe views
```

---

### **Milestone 6: Layout & View System Updates**
**Goal**: Integrate ElectronBrowserView into existing Layout.tsx and view system, remove IframeView component (Electron-only architecture)

**Tasks**:
- [ ] Update `app/src/components/layout/Layout.tsx` - import ElectronBrowserView
- [ ] Update iframe view rendering to use ElectronBrowserView (no fallback, pure Electron)
- [ ] Delete `app/src/components/IframeView.tsx` (no longer needed)
- [ ] Test navigating to `/web/gmail` route - should show Gmail in BrowserView
- [ ] Test navigating to `/web/messages` route - should show Messages in BrowserView
- [ ] Test navigating to `/web/wikipedia` route - should show Wikipedia in BrowserView
- [ ] Test switching between task views and iframe views (BrowserView should show/hide correctly)
- [ ] Test keyboard navigation from sidebar to iframe views
- [ ] Verify no TypeScript errors after removing IframeView

**Success Criteria**:
- ✅ Can navigate to `/web/gmail` from sidebar and see Gmail load in BrowserView
- ✅ Can navigate to `/web/messages` from sidebar and see Messages load
- ✅ Can navigate to `/web/wikipedia` from sidebar and see Wikipedia load
- ✅ Switching from Gmail to Inbox view hides BrowserView and shows task list
- ✅ Switching from Inbox to Gmail shows BrowserView again
- ✅ IframeView.tsx deleted successfully
- ✅ All existing task management features still work (Inbox, Projects, Routines, etc.)
- ✅ Typecheck passes: `bun run typecheck`
- ✅ Lint passes: `bun run lint`
- ✅ Tests pass: `bun test`
- ✅ User can verify: Navigate through all views via sidebar, confirm Gmail/Messages/Wikipedia work

**Completion Notes**:
```
Date:
Status:

Notes:
- Updated Layout.tsx to use ElectronBrowserView for iframe views (pure Electron, no fallback)
- Removed IframeView.tsx completely (Electron-only architecture)
- View switching pattern: [how it works]
- BrowserView show/hide behavior: [implementation details]

Test Results:
- ✅ Gmail navigation: [result]
- ✅ Messages navigation: [result]
- ✅ Wikipedia navigation: [result]
- ✅ View switching: [BrowserView shows/hides correctly]
- ✅ Existing features: [Inbox, Projects, Routines all work]
- ✅ Typecheck: [result]
- ✅ Lint: [result]
- ✅ Tests: [result]
- ✅ User verified: [all views navigable via sidebar]

Files Modified (1):
- app/src/components/layout/Layout.tsx (Updated iframe view rendering to use ElectronBrowserView)

Files Deleted (1):
- app/src/components/IframeView.tsx (Electron-only, no web fallback needed)

Issues encountered:
- [Any view switching or routing issues]

Next steps:
- Milestone 7: Build, package, and distribution setup
- Configure electron-vite build process
- Set up electron-builder for DMG creation
- Create app icons (icon.icns, tray icons)
```

---

### **Milestone 7: Build, Package & Distribution Setup**
**Goal**: Configure Electron build process, create DMG packaging, and generate macOS app icons

**Tasks**:
- [ ] Test Electron build: `bun run electron:build` (should create dist-electron folder)
- [ ] Verify build output structure: main, preload, renderer folders in dist-electron
- [ ] Test built app: `open app/dist-electron/mac/Convex\ DB.app` (if exists)
- [ ] Create app icon from PNG (1024x1024) using iconutil (see command in plan)
- [ ] Generate tray icons: tray-icon.png (16x16), tray-icon@2x.png (32x32)
- [ ] Place icons in `electron/resources/` folder
- [ ] Update `electron-builder.json` to reference icon paths
- [ ] Test DMG creation: `bun run electron:dist`
- [ ] Test DMG installer: Open DMG and drag app to Applications folder
- [ ] Launch installed app and verify it works identically to dev mode
- [ ] Verify Convex connection works in production build

**Success Criteria**:
- ✅ `bun run electron:build` completes without errors
- ✅ dist-electron folder contains main, preload, renderer with correct files
- ✅ App icons appear correctly (512x512 minimum)
- ✅ Tray icon appears correctly in menu bar
- ✅ DMG file created successfully
- ✅ Can install app from DMG to /Applications
- ✅ Installed app launches and connects to Convex
- ✅ All features work in production build (Gmail, Messages, Wikipedia, task management)
- ✅ Typecheck passes: `bun run typecheck`
- ✅ User can verify: DMG installs cleanly, app works after installation

**Completion Notes**:
```
Date:
Status:

Notes:
- Configured electron-vite build with [settings]
- Generated app icons from [source PNG]
- Created DMG with [settings from electron-builder.json]
- Production build size: [X MB]

Test Results:
- ✅ Build completes: [time, output size]
- ✅ App icons: [shown correctly in Dock, Finder]
- ✅ Tray icon: [shown correctly in menu bar]
- ✅ DMG creation: [success, file size]
- ✅ Installation: [installs to /Applications successfully]
- ✅ Production launch: [app works after install]
- ✅ Convex connection: [WebSocket connection successful]
- ✅ All features: [Gmail, Messages, Wikipedia, tasks all work]
- ✅ Typecheck: [result]

Files Created (3):
- electron/resources/icon.icns ([size]) - macOS app icon
- electron/resources/tray-icon.png (16x16) - Tray icon
- electron/resources/tray-icon@2x.png (32x32) - Retina tray icon

Issues encountered:
- [Any build or packaging issues]

Next steps:
- Milestone 8: Comprehensive testing and validation
- Test all 20+ views
- Test all keyboard shortcuts
- Test session persistence (logout/login)
- Verify window state persistence
```

---

### **Milestone 8: Comprehensive Testing & Validation**
**Goal**: Thoroughly test all features in Electron app to ensure functional parity with web app, and validate deployment readiness

**Tasks**:
- [ ] Test all task management features (create, update, delete, complete, archive)
- [ ] Test all 20+ views (Inbox, Today, Upcoming, Projects, Routines, Priorities, Labels, Gmail, Messages, Wikipedia)
- [ ] Test all keyboard shortcuts (arrow keys, 'n' for new task, '?' for help, etc.)
- [ ] Test all global shortcuts (Cmd+Shift+Space for quick add, Cmd+Shift+I for inbox, Cmd+Shift+T for toggle)
- [ ] Test system tray menu (Show App, Quick Add, Inbox, Priority Queue, Quit)
- [ ] Test Convex sync (create task in app, verify in Todoist; create task in Todoist, verify in app)
- [ ] Test Gmail login persistence (logout, close app, reopen, verify still logged out; login, close app, reopen, verify still logged in)
- [ ] Test Messages login persistence (same as Gmail)
- [ ] Test window state persistence (resize window, close, reopen, verify size persists; move window, close, reopen, verify position persists)
- [ ] Test dark mode sync with macOS system (change system theme, verify app theme updates)
- [ ] Test native notifications (complete task, verify notification appears)
- [ ] Test external link handling (click link in Gmail, verify opens in default browser)
- [ ] Run full validation suite: `bun run typecheck && bun run lint && bun test`
- [ ] Test on fresh macOS install (if possible) to verify DMG installation works for new users

**Success Criteria**:
- ✅ All task management features work identically to web app
- ✅ All 20+ views render correctly and are navigable
- ✅ All keyboard shortcuts work as expected
- ✅ All global shortcuts work system-wide (even when app is hidden)
- ✅ System tray menu functional with all items working
- ✅ Convex sync bidirectional (app ↔ Todoist)
- ✅ Gmail session persists across app restarts
- ✅ Messages session persists across app restarts
- ✅ Window size and position persist across restarts
- ✅ Dark mode syncs automatically with macOS system theme
- ✅ Native notifications appear correctly
- ✅ External links open in default browser (not in BrowserView)
- ✅ Full validation passes: `bun run typecheck && bun run lint && bun test`
- ✅ DMG installs successfully on fresh macOS system
- ✅ User can verify: Complete testing checklist, all features work

**Completion Notes**:
```
Date:
Status:

Notes:
- Tested [X] features across [Y] views
- All keyboard shortcuts verified
- Session persistence confirmed: [details]
- Window state management working: [details]

Test Results:
- ✅ Task management: [all CRUD operations work]
- ✅ Views: [20+ views tested, all render correctly]
- ✅ Keyboard shortcuts: [list tested shortcuts]
- ✅ Global shortcuts: [tested from other apps]
- ✅ Tray menu: [all menu items functional]
- ✅ Convex sync: [bidirectional sync confirmed]
- ✅ Gmail session: [persists across restarts]
- ✅ Messages session: [persists across restarts]
- ✅ Window state: [size/position persists]
- ✅ Dark mode: [syncs with macOS system]
- ✅ Notifications: [native notifications appear]
- ✅ External links: [open in default browser]
- ✅ Validation suite: [typecheck: 0 errors, lint: pass, tests: pass]
- ✅ Fresh install: [DMG installs and runs successfully]

Issues encountered:
- [Any issues found during testing and how they were resolved]

Known limitations:
- [Any known issues or limitations to document]

Next steps:
- Migration complete! Ready for user deployment
- Consider: Auto-updater setup (future enhancement)
- Consider: Windows/Linux builds (future enhancement)
```

---

## 📊 Progress Tracking

**Overall Completion**: 0/8 milestones (0%)

- [x] Planning & Research (COMPLETED)
- [ ] Milestone 1: Project Setup & Configuration
- [ ] Milestone 2: Main Process Core (Window, Tray, Shortcuts)
- [ ] Milestone 3: BrowserView Manager (Key Feature)
- [ ] Milestone 4: IPC Bridge (Preload Script + IPC Handlers)
- [ ] Milestone 5: Renderer Integration (API Detection + ElectronBrowserView Component)
- [ ] Milestone 6: Layout & View System Updates
- [ ] Milestone 7: Build, Package & Distribution Setup
- [ ] Milestone 8: Comprehensive Testing & Validation

---

## 🗂️ File Inventory

### Files to Create (14)

**Electron Main Process (7)**:
- [ ] `electron/main/main.ts` - Main process entry point, app lifecycle, IPC setup
- [ ] `electron/main/window.ts` - Window creation with macOS native title bar
- [ ] `electron/main/browserview.ts` - BrowserView manager for Gmail, Messages, Wikipedia
- [ ] `electron/main/tray.ts` - System tray integration with menu
- [ ] `electron/main/shortcuts.ts` - Global keyboard shortcuts registration
- [ ] `electron/main/notifications.ts` - Native notification manager
- [ ] `electron/main/ipc/index.ts` - IPC handlers for storage, notifications, views

**Electron Preload (1)**:
- [ ] `electron/preload/preload.ts` - Preload script exposing electronAPI via contextBridge

**React App (3)**:
- [ ] `app/src/lib/electron/api.ts` - Electron detection utilities (isElectron, electronAPI)
- [ ] `app/src/components/ElectronBrowserView.tsx` - React component to control BrowserView
- [ ] `app/src/hooks/useElectronStorage.ts` - Electron-aware storage hook (pure Electron, throws if not in context)

**Configuration (3)**:
- [ ] `app/electron.vite.config.ts` - Electron Vite configuration (main, preload, renderer)
- [ ] `electron-builder.json` - Electron Builder configuration for macOS DMG packaging
- [ ] `.env.electron` - Electron environment variables (VITE_CONVEX_URL)

### Files to Modify (2)
- [ ] `app/src/components/layout/Layout.tsx` - Use ElectronBrowserView for iframe views (pure Electron, no fallback)
- [ ] `package.json` (root) - Add Electron dependencies and scripts

### Files to Delete (1)
- [ ] `app/src/components/IframeView.tsx` - No longer needed (Electron-only, no web fallback)

### Resources to Create (3)
- [ ] `electron/resources/icon.icns` - macOS app icon (512x512 minimum, generated from 1024x1024 PNG)
- [ ] `electron/resources/tray-icon.png` - System tray icon (16x16)
- [ ] `electron/resources/tray-icon@2x.png` - Retina tray icon (32x32)

---

## 🔍 Key Technical Decisions

### Decision 1: Electron-Only Architecture (No Web Fallback)
**Problem**: Should we maintain web browser compatibility or go pure Electron?

**Options Considered**:
1. **Hybrid approach**: Keep web app, add Electron as optional enhancement
   - Pros: Users can still use web browser, gradual migration
   - Cons: Two codepaths to maintain, complex conditional logic, doesn't fully solve Gmail/Messages blocking
2. **Electron-only**: Deprecate web app entirely, pure Electron
   - Pros: Single codebase, simpler logic, best desktop experience, fully solves Gmail/Messages
   - Cons: Requires users to install app, larger distribution size

**Decision**: Electron-only (Option 2)

**Rationale**: User explicitly chose this approach to simplify architecture. The primary goal is solving Gmail/Messages embedding restrictions, which can only be fully solved with BrowserView API. Maintaining two codepaths adds unnecessary complexity. The desktop experience (system tray, global shortcuts, native notifications) is significantly better than web app, justifying the installation requirement.

---

### Decision 2: BrowserView API vs. Webview Tag
**Problem**: How to embed Gmail, Messages, and Wikipedia without X-Frame-Options restrictions?

**Options Considered**:
1. **Webview Tag**: Electron's older embedding API
   - Pros: Simpler API, easier to position
   - Cons: Deprecated, security concerns, less control
2. **BrowserView API**: Electron's modern native view API
   - Pros: Bypasses X-Frame-Options completely, full native integration, secure, recommended by Electron
   - Cons: More complex positioning, requires main process management

**Decision**: BrowserView API (Option 2)

**Rationale**: BrowserView is Electron's recommended modern API and fully bypasses X-Frame-Options headers. Webview tag is deprecated and has known security issues. BrowserView provides better control, persistent sessions (stay logged in), and native integration. The complexity of main process management is worth the security and functionality benefits.

---

### Decision 3: Pre-Create BrowserViews vs. On-Demand Creation
**Problem**: When should BrowserViews be created?

**Options Considered**:
1. **On-demand**: Create BrowserView when user navigates to view
   - Pros: Lower memory usage, faster startup
   - Cons: Slower view switching, more complex lifecycle management
2. **Pre-create**: Create all BrowserViews at app startup
   - Pros: Instant view switching, simpler management, views can load in background
   - Cons: Higher memory usage (~100MB per view)

**Decision**: Pre-create (Option 2)

**Rationale**: Only 3 views (Gmail, Messages, Wikipedia) need pre-creation, so memory impact is acceptable. Users expect instant switching when clicking sidebar items. Pre-creating allows views to load and login in background while user works on tasks. Simpler lifecycle management reduces bugs. Modern Macs have sufficient memory to handle 3 background views.

---

### Decision 4: Persistent Sessions for BrowserViews
**Problem**: How to handle login state across app restarts?

**Options Considered**:
1. **Ephemeral sessions**: Cookies cleared on app restart
   - Pros: More private, no state persistence
   - Cons: User has to re-login every time
2. **Persistent sessions**: Cookies and state persist across restarts
   - Pros: Stay logged into Gmail/Messages, better UX
   - Cons: More data on disk, potential privacy concern

**Decision**: Persistent sessions (Option 2)

**Rationale**: Users expect to stay logged into Gmail and Messages like in a regular browser. Re-logging in every app restart would be frustrating. This is standard browser behavior. Security is maintained through Electron's session partitioning (each view has isolated storage). Users can manually log out if desired.

---

### Decision 5: electron-vite vs. Manual Webpack Configuration
**Problem**: Which build tool to use for Electron?

**Options Considered**:
1. **Manual Webpack**: Configure webpack for main, preload, renderer
   - Pros: Full control, well-documented
   - Cons: Complex configuration, slow, no HMR out-of-box
2. **electron-vite**: Official Electron + Vite integration
   - Pros: Fast HMR, automatic configuration, Vite ecosystem compatibility
   - Cons: Newer tool, less community examples

**Decision**: electron-vite (Option 2)

**Rationale**: Project already uses Vite for web app, so staying in Vite ecosystem reduces friction. electron-vite provides excellent developer experience with HMR for renderer and auto-restart for main process. It's officially maintained by the Vite team. The existing Vite configuration (path aliases, plugins) can be reused.

---

### Decision 6: electron-store vs. localStorage
**Problem**: How to handle persistent storage in Electron?

**Options Considered**:
1. **localStorage**: Use browser's localStorage API
   - Pros: Works unchanged from web app
   - Cons: Limited to string storage, no encryption, browser-specific quirks
2. **electron-store**: Dedicated Electron storage library
   - Pros: Supports any JSON data, encryption, atomic writes, desktop-optimized
   - Cons: Different API from localStorage, requires migration

**Decision**: electron-store (Option 2)

**Rationale**: electron-store is purpose-built for Electron and provides better reliability (atomic writes prevent corruption), supports encryption for sensitive data, and handles any JSON-serializable data (not just strings). The API difference is minimal, and we can create a hook (useElectronStorage) to abstract the interface. Since we're going Electron-only (no web fallback), there's no need to maintain localStorage compatibility.

---

### Decision 7: Delete IframeView vs. Keep as Fallback
**Problem**: Should we keep IframeView component for potential future web version?

**Options Considered**:
1. **Keep IframeView**: Maintain component with conditional rendering
   - Pros: Could support web version later
   - Cons: Dead code in Electron-only app, maintenance burden
2. **Delete IframeView**: Remove component entirely
   - Pros: Cleaner codebase, no dead code, explicit Electron-only architecture
   - Cons: Hard to revert if we want web version later

**Decision**: Delete IframeView (Option 2)

**Rationale**: We explicitly chose Electron-only architecture. Keeping dead code "just in case" adds maintenance burden and could cause confusion. If we need web version later, we can restore it from git history. Clean deletion makes the architecture explicit and prevents accidental usage of the wrong component.

---

## 🚨 Known Edge Cases

### 1. Gmail/Messages Login Redirect
**Description**: When logging into Gmail or Messages, they may redirect to consent/verification pages that try to open in new windows.

**Handling**:
- BrowserView's `setWindowOpenHandler` catches new window attempts
- Opens URLs in default browser instead of creating new BrowserViews
- User completes login in browser, then refreshes BrowserView

**Testing**: Log out of Gmail, close app, reopen, attempt login, verify redirect opens in browser

---

### 2. BrowserView Z-Index Layering
**Description**: BrowserView renders as native Chromium view, not part of React's DOM. It always renders "on top" of React content.

**Handling**:
- Call `hideAllViews()` when switching to non-iframe views
- Ensure Layout.tsx only renders ElectronBrowserView when `isIframeView` is true
- BrowserView is removed from window when not needed

**Testing**: Switch from Gmail to Inbox view, verify Gmail disappears and task list shows. Switch back to Gmail, verify BrowserView reappears.

---

### 3. Window Resize During BrowserView Display
**Description**: BrowserView needs manual resizing when window size changes.

**Handling**:
- BrowserView's `setAutoResize` enables automatic width/height adjustment
- BrowserView maintains bounds relative to window
- No manual resize listeners needed

**Testing**: Display Gmail, resize window by dragging corners, verify Gmail resizes to fill window

---

### 4. Multiple Instances of App
**Description**: User might try to open app twice (double-click icon while app is already running).

**Handling**:
- Electron's `app.requestSingleInstanceLock()` ensures only one instance runs
- Second instance attempt focuses the existing window instead of opening new app
- (Optional) Can implement in `electron/main/main.ts` if needed

**Testing**: Open app, minimize/hide to tray, double-click app icon again, verify existing window shows instead of new instance launching

---

### 5. Convex WebSocket Connection in Packaged App
**Description**: Packaged app might have different environment variable handling than dev mode.

**Handling**:
- Use `.env.electron` file for production builds
- electron-vite automatically injects environment variables at build time
- Convex client reads `import.meta.env.VITE_CONVEX_URL` (works in both dev and production)

**Testing**: Build DMG, install app, launch, verify Convex connection works (check for task data loading)

---

### 6. macOS Gatekeeper / Code Signing
**Description**: macOS may block app from launching if not signed with Apple Developer certificate.

**Handling**:
- For development: User can right-click → Open to bypass Gatekeeper
- For distribution: Would need Apple Developer account + code signing
- electron-builder config includes `hardenedRuntime: true` for future signing

**Testing**: Build DMG, install on different Mac without Gatekeeper disabled, verify app opens (may require right-click → Open)

---

### 7. System Tray Icon Dark/Light Mode
**Description**: Tray icon needs different versions for light and dark macOS themes.

**Handling**:
- Use "template" naming convention: `icon-Template.png`
- macOS automatically inverts colors based on menu bar theme
- Alternatively: Provide both light and dark versions, detect system theme

**Testing**: Create tray icon with template naming, test on both light and dark macOS themes, verify icon is always visible

---

## 📝 Notes & Learnings

### Development Notes
```
[Space for ongoing notes during implementation - agents should add entries here as they work]

Example:
- 2025-12-02: Initial plan created
- 2025-12-03: Discovered BrowserView requires manual bounds management
- 2025-12-04: electron-store works great for session persistence
```

### Issues Encountered
```
[Track all issues and resolutions here - critical for future debugging]

Example:
- Issue: TypeScript can't find window.electronAPI type
  Resolution: Added declare global block in preload.ts

- Issue: BrowserView doesn't resize with window
  Resolution: Used setAutoResize({ width: true, height: true })
```

### Future Enhancements
- [ ] Auto-updater with GitHub releases (electron-updater is already installed)
- [ ] Windows and Linux builds (electron-builder supports cross-platform)
- [ ] macOS menu bar app (hideDock + always-visible menubar icon)
- [ ] Today view widget for macOS Notification Center
- [ ] Spotlight integration (search tasks via macOS Spotlight)
- [ ] Multiple windows (separate window per view)
- [ ] Touch Bar support for MacBook Pro
- [ ] Notification actions (complete/snooze from notification)

---

## 🔗 References

### Key Files
- `/Users/mimen/Programming/Repos/convex-db/app/vite.config.ts` - Current Vite configuration (path aliases, security headers)
- `/Users/mimen/Programming/Repos/convex-db/app/src/components/layout/Layout.tsx` - Main layout orchestrator (view switching logic)
- `/Users/mimen/Programming/Repos/convex-db/app/src/lib/views/types.ts` - View type system (ViewKey definitions)
- `/Users/mimen/Programming/Repos/convex-db/app/src/lib/routing/utils.ts` - URL routing (ViewKey ↔ URL path mapping)
- `/Users/mimen/Programming/Repos/convex-db/app/src/components/IframeView.tsx` - Current iframe implementation (reference before deletion)

### Similar Patterns
- **BrowserView Example**: [Electron BrowserView docs](https://www.electronjs.org/docs/latest/api/browser-view) - Official API documentation
- **electron-vite**: [electron-vite.org](https://electron-vite.org/) - Build tool documentation
- **electron-store**: [GitHub](https://github.com/sindresorhus/electron-store) - Persistent storage library

### Commands

```bash
# Development
bunx convex dev                                  # Start Convex dev server (Terminal 1)
bun run electron:dev                             # Start Electron in dev mode (Terminal 2)

# Validation (REQUIRED before commits)
bun run typecheck && bun run lint && bun test   # Run full validation suite

# Building & Packaging
bun run electron:build                           # Build Electron app (local testing)
bun run electron:dist                            # Create DMG for distribution

# Testing Packaged App
open app/dist-electron/mac/Convex\ DB.app       # Test packaged app (after build)
open release/*/Convex\ DB-*.dmg                  # Test DMG installer (after dist)

# Icon Generation (macOS)
mkdir icon.iconset
sips -z 16 16     icon.png --out icon.iconset/icon_16x16.png
sips -z 32 32     icon.png --out icon.iconset/icon_16x16@2x.png
# ... (see Milestone 7 for full command)
iconutil -c icns icon.iconset
mv icon.icns electron/resources/

# Debugging
open app/dist-electron/mac/Convex\ DB.app --args --remote-debugging-port=9222  # Debug packaged app

# Electron Version Check
bunx electron --version                          # Verify Electron installation
```

---

**Last Updated**: 2025-12-02 (Initial planning phase completed)

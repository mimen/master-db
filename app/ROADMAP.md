# Frontend Roadmap

## Planned Features

### Command Palette (Cmd+K)

**Status**: Planned
**Dependencies**: `cmdk` (already installed), `useGlobalHotkeys` hook

**Implementation Plan**:

1. **Command Palette Component** (`src/components/CommandPalette.tsx`)
   - Native `<dialog>` element for consistency with existing dialogs
   - cmdk library for fuzzy search and keyboard navigation
   - Categories: Navigation, Actions, Quick Add, Search

2. **Global Hotkey Integration**
   - Use `useGlobalHotkeys` hook with scope stacking
   - Cmd+K / Ctrl+K opens palette (highest priority scope)
   - Palette shortcuts override all other shortcuts when open
   - ESC closes palette and pops scope

3. **Command Categories**:
   - **Navigation**: Jump to views (inbox, today, projects, priorities, labels)
   - **Actions**: Complete task, delete task, set priority, assign project
   - **Quick Add**: Create task, create project
   - **Search**: Search tasks by content, labels, projects

4. **Scope Priority System**:
   ```
   Command Palette (highest)
     └─> Task Dialogs (priority, project, label, etc.)
         └─> Task Navigation (arrow keys)
             └─> Global shortcuts (p, #, @, s, c, Delete)
   ```

5. **Benefits**:
   - Single keystroke access to any view or action
   - Fuzzy search for quick navigation
   - Discoverability of all keyboard shortcuts
   - Professional UX (matches VS Code, Linear, Notion)

**Design Notes**:
- Keep native `<dialog>` pattern for consistency
- Integrate with existing `DialogProvider` context
- Use `useGlobalHotkeys` for proper scope management
- Maintain keyboard-first philosophy

---

## Completed

### Keyboard Shortcuts Help Dialog
- Native `<dialog>` implementation
- ? key to open
- Documents all existing shortcuts

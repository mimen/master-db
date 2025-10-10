# Keyboard Shortcuts Architecture

## Overview

Our keyboard shortcuts system uses a **three-tier architecture** that separates global shortcuts, contextual shortcuts, and dialog shortcuts. This design scales as we add new entity types and features.

## Architecture Principles

### 1. Global Shortcuts
**Location**: `app/src/hooks/useGlobalShortcuts.ts`

**Purpose**: Shortcuts that work anywhere in the app, regardless of context or what's focused.

**Current Implementation**:
- Arrow navigation (↑/↓/←/→) - Navigate between tasks/views
- `?` (Shift+?) - Open keyboard shortcuts help dialog
- Tab handling - Prevent default Tab behavior

**Usage** (in Layout or top-level component):
```typescript
import { useGlobalShortcuts } from '@/hooks/useGlobalShortcuts'

function Layout() {
  useGlobalShortcuts({
    onNavigateNext: () => handleArrowNavigation(1),
    onNavigatePrevious: () => handleArrowNavigation(-1),
    onShowHelp: openShortcuts,
  })
  // ... rest of component
}
```

**Implementation Pattern** (inside the hook):
```typescript
export function useGlobalShortcuts({ onNavigateNext, onNavigatePrevious, onShowHelp }) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      // Skip if user is typing
      const isTextInput = /* check for input/textarea/contentEditable */
      if (isTextInput) return

      switch (event.key) {
        case '?':
          if (event.shiftKey) onShowHelp()
          break
        case 'ArrowDown':
        case 'ArrowRight':
          onNavigateNext()
          break
        // ... more shortcuts
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onNavigateNext, onNavigatePrevious, onShowHelp])
}
```

**When to add global shortcuts**:
- Navigation that applies across all views (arrow keys)
- App-wide actions (search, settings, help)
- View switching or layout changes

**How to add new global shortcuts**:
1. Add the handler to the `GlobalShortcutsConfig` interface in `useGlobalShortcuts.ts`
2. Add the keyboard event handler in the switch statement
3. Update the hook usage in `Layout.tsx` to pass the handler
4. Document in `KeyboardShortcutsDialog.tsx`

---

### 2. Contextual Shortcuts (Entity-Specific)
**Location**: `app/src/hooks/useTaskDialogShortcuts.ts` (for tasks)

**Purpose**: Shortcuts that only work when a specific entity is focused/selected.

**Current Implementation** (for tasks):
- `p` - Set priority
- `#` - Move to project
- `@` - Add labels
- `s` - Schedule (due date)
- `Shift+D` - Set deadline
- `c` - Complete task
- `Delete`/`Backspace` - Delete task

**Pattern**:
```typescript
export function useTaskDialogShortcuts(focusedTask: TodoistTask | null) {
  const { openPriority, openProject, /* ... */ } = useDialogContext()

  useEffect(() => {
    if (!focusedTask) return // Only active when entity is focused

    const handleKeyDown = (e: KeyboardEvent) => {
      // Skip if user is typing in input fields
      if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
        return
      }

      switch (e.key) {
        case 'p':
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) {
            e.preventDefault()
            openPriority(focusedTask)
          }
          break
        // ... more contextual shortcuts
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [focusedTask, /* dialog handlers */])
}
```

**When to add contextual shortcuts**:
- Actions specific to a focused entity (task, project, note, etc.)
- Entity-specific dialogs or modifications
- Bulk actions on selected items

---

## Expansion Strategy

### Adding Shortcuts for New Entity Types

When adding keyboard shortcuts for new entities (e.g., projects, notes, calendar events):

1. **Create a new contextual hook**: `app/src/hooks/use[Entity]DialogShortcuts.ts`
   ```typescript
   export function useProjectDialogShortcuts(focusedProject: Project | null) {
     // Similar pattern to useTaskDialogShortcuts
   }
   ```

2. **Keep shortcuts mnemonic and consistent**:
   - Use same keys for similar actions across entities (e.g., `p` for priority)
   - Use Shift modifiers for "stronger" versions (e.g., `d` vs `Shift+D`)
   - Reserve special characters for specific domains (`#` projects, `@` labels)

3. **Update the help dialog**: `app/src/components/dialogs/KeyboardShortcutsDialog.tsx`
   - Add new section for the entity type
   - Document all shortcuts with clear descriptions

### Key Assignment Guidelines

**Single keys** (no modifiers):
- Common, frequent actions
- Actions that don't conflict with typing
- Examples: `p` (priority), `s` (schedule), `c` (complete)

**Shift + key**:
- Related but less frequent actions
- "Stronger" versions of actions
- Examples: `#` (project), `@` (labels), `Shift+D` (deadline)

**Ctrl/Cmd + key**:
- Reserved for browser/OS shortcuts where possible
- Use sparingly to avoid conflicts
- Examples: Browser's Cmd+T, Cmd+W should still work

**Special keys**:
- Arrow keys: Navigation only (global)
- Enter: Confirm actions (in dialogs)
- Escape: Cancel/close (in dialogs)
- Delete/Backspace: Destructive actions
- Tab: Reserved (currently disabled)

---

### 3. Dialog-Level Shortcuts
**Location**: Inside individual dialog components (e.g., `PriorityDialog.tsx`, `DueDateDialog.tsx`)

**Purpose**: Shortcuts specific to a single dialog's UI and navigation.

**Current Examples**:
- **Priority Dialog** (`PriorityDialog.tsx:45-87`): Number keys 1-4, arrow navigation
- **Due Date Dialog** (`DueDateDialog.tsx:80-105`): Arrow navigation, Enter to confirm
- **All Dialogs**: Escape to cancel, Enter to confirm

**Pattern**: Each dialog implements its own `useEffect` attached to the dialog element.

**Example** (from Priority Dialog):
```typescript
export function PriorityDialog({ task, onSelect, onClose }) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const [focusedIndex, setFocusedIndex] = useState(0)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !task) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Stop propagation so global shortcuts don't fire
      if (e.key !== 'Escape') {
        e.stopPropagation()
      }

      switch (e.key) {
        case '1': onSelect(4); break  // P1 = priority 4 (API)
        case '2': onSelect(3); break  // P2 = priority 3
        case '3': onSelect(2); break  // P3 = priority 2
        case '4': onSelect(1); break  // P4 = priority 1
        case 'ArrowUp':
          e.preventDefault()
          setFocusedIndex(prev => Math.max(0, prev - 1))
          break
        case 'ArrowDown':
          e.preventDefault()
          setFocusedIndex(prev => Math.min(priorities.length - 1, prev + 1))
          break
        case 'Enter':
          e.preventDefault()
          onSelect(priorities[focusedIndex].value)
          break
      }
    }

    dialog.addEventListener('keydown', handleKeyDown)
    return () => dialog.removeEventListener('keydown', handleKeyDown)
  }, [task, onSelect, focusedIndex])

  // ... render dialog
}
```

**Why dialog-level shortcuts are separate**:
- Tightly coupled to dialog's UI state (e.g., `focusedIndex`)
- Need to override global shortcuts (e.g., arrow keys for navigation vs option selection)
- Event propagation control (`stopPropagation` prevents global handlers from firing)
- Dialog lifecycle (only active when dialog is open)

**When to add dialog shortcuts**:
- Quick selection (number keys, letter keys)
- Navigation within dialog options
- Confirmation/cancellation specific to that dialog
- Any shortcut that requires access to dialog's internal state

---

## Future Infrastructure: Global Hotkeys System

**Location**: `app/src/hooks/useGlobalHotkeys.ts`

We have built a sophisticated scope-based hotkey system that is **currently unused**. This infrastructure provides:

- **Scoped shortcuts**: Different contexts can define their own shortcuts
- **Priority system**: Higher priority scopes take precedence
- **Stack-based resolution**: Overlays/modals can override base shortcuts
- **Normalized key handling**: Consistent key combination parsing

**When to migrate to useGlobalHotkeys**:
- When we have complex overlapping shortcut contexts
- When we need dynamic shortcut registration/unregistration
- When priority-based resolution becomes necessary
- When we want a single source of truth for all shortcuts

**Current approach is simpler and more explicit**, which is appropriate for our current scope. The `useGlobalHotkeys` system is there when we need it.

---

## Documentation Requirements

When adding new shortcuts:

1. **Update `KeyboardShortcutsDialog.tsx`** with the new shortcuts
2. **Add comments** in the hook explaining why each key was chosen
3. **Test for conflicts** with browser shortcuts and other entity shortcuts
4. **Update this document** with any new patterns or guidelines

---

## Testing Shortcuts

**Manual testing checklist**:
- [ ] Shortcut works when entity is focused
- [ ] Shortcut doesn't fire when typing in input fields
- [ ] Shortcut doesn't conflict with browser shortcuts (Cmd+T, Cmd+W, etc.)
- [ ] Shortcut doesn't conflict with other entity shortcuts
- [ ] Dialog opens/closes correctly
- [ ] Escape key cancels dialog
- [ ] Enter key confirms dialog action

**Edge cases to test**:
- Multiple modifiers (Shift+Ctrl+key)
- Non-English keyboard layouts
- Accessibility tools (screen readers, keyboard navigation)

---

## Current File Structure

```
app/src/
├── components/
│   ├── layout/
│   │   └── Layout.tsx                          # Uses useGlobalShortcuts
│   └── dialogs/
│       ├── KeyboardShortcutsDialog.tsx         # Documentation (user-facing)
│       ├── PriorityDialog.tsx                  # Dialog shortcuts (internal)
│       ├── DueDateDialog.tsx                   # Dialog shortcuts (internal)
│       └── ...
├── hooks/
│   ├── useGlobalShortcuts.ts                   # Global shortcuts (Tier 1)
│   ├── useTaskDialogShortcuts.ts               # Task contextual shortcuts (Tier 2)
│   ├── use[Entity]DialogShortcuts.ts           # Future: Other entities (Tier 2)
│   └── useGlobalHotkeys.ts                     # Advanced infrastructure (unused)
└── contexts/
    └── DialogContext.tsx                        # Dialog state management
```

---

## Migration Path (If Needed)

If we decide to use `useGlobalHotkeys` in the future:

1. **Phase 1**: Register global shortcuts from Layout.tsx
   ```typescript
   const hotkeys = useGlobalHotkeys()

   useEffect(() => {
     return hotkeys.registerScope({
       id: 'global-navigation',
       priority: 0,
       handlers: {
         'arrowdown': () => { handleArrowNavigation(1); return true },
         'arrowup': () => { handleArrowNavigation(-1); return true },
         'shift+?': () => { openShortcuts(); return true },
       }
     })
   }, [hotkeys])
   ```

2. **Phase 2**: Register contextual shortcuts with higher priority
   ```typescript
   useEffect(() => {
     if (!focusedTask) return

     return hotkeys.registerScope({
       id: 'task-actions',
       priority: 10, // Higher than global
       handlers: {
         'p': () => { openPriority(focusedTask); return true },
         // ...
       }
     })
   }, [focusedTask, hotkeys])
   ```

3. **Phase 3**: Use stack-based scoping for dialogs
   ```typescript
   useEffect(() => {
     if (isOpen) {
       hotkeys.pushScope('priority-dialog')
     }
     return () => hotkeys.popScope('priority-dialog')
   }, [isOpen, hotkeys])
   ```

**Note**: Only migrate if the current simple approach becomes unmaintainable.

---

## Summary

Three-tier architecture for keyboard shortcuts:

1. **Global shortcuts** (`useGlobalShortcuts.ts`) - App-wide navigation and actions
2. **Contextual shortcuts** (`use[Entity]DialogShortcuts.ts`) - Entity-specific actions when focused
3. **Dialog shortcuts** (inside dialog components) - Dialog-specific navigation and quick actions

**Advanced infrastructure**: `useGlobalHotkeys.ts` provides scope-based hotkey system for future complex scenarios.

**Documentation**: All user-facing shortcuts documented in `KeyboardShortcutsDialog.tsx`.

This architecture keeps implementation simple while providing clear expansion paths as the application grows.

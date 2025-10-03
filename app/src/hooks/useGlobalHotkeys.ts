import { useCallback, useEffect, useMemo, useRef } from "react";

export type HotkeyHandler = (event: KeyboardEvent) => boolean | void;

export type HotkeyMap = Record<string, HotkeyHandler>;

export interface GlobalHotkeyScope {
  /** Unique identifier for the scope (e.g., "sidebar", "table", "overlay"). */
  id: string;
  /**
   * Map of key combinations to handlers. Combinations use `+`-joined tokens,
   * e.g., `"ArrowUp"`, `"ctrl+k"`, `"shift+Tab"`. Letter keys are case-insensitive.
   */
  handlers: HotkeyMap;
  /**
   * Optional predicate that tells the dispatcher whether this scope should be
   * considered for the current event. Defaults to `true`.
   */
  isActive?: () => boolean;
  /** Larger numbers run earlier when no scope stack is defined. Default `0`. */
  priority?: number;
}

export interface GlobalHotkeysApi {
  /** Register a scope and receive an unregister callback. */
  registerScope: (scope: GlobalHotkeyScope) => () => void;
  /**
   * Push a scope onto the stack so it is evaluated before others (e.g., overlays).
   * If the scope is already on the stack it is moved to the top.
   */
  pushScope: (scopeId: string) => void;
  /** Remove the top-most stacked scope or a specific scope id. */
  popScope: (scopeId?: string) => void;
  /** Clear the explicit stack ordering, falling back to priority sorting. */
  clearScopeStack: () => void;
}

const SPECIAL_KEY_ALIASES: Record<string, string> = {
  " ": "space",
  Escape: "esc",
  ArrowUp: "arrowup",
  ArrowDown: "arrowdown",
  ArrowLeft: "arrowleft",
  ArrowRight: "arrowright",
  PageUp: "pageup",
  PageDown: "pagedown",
};

const MODIFIER_KEYS = ["Shift", "Meta", "Alt", "Control"];

type NormalizedCombo = string;

function normalizeKey(event: KeyboardEvent): NormalizedCombo {
  const parts: string[] = [];

  if (event.metaKey) {
    parts.push("meta");
  }

  // Treat ctrl separately so Cmd+Ctrl combos can exist on macOS.
  if (event.ctrlKey) {
    parts.push("ctrl");
  }

  if (event.altKey) {
    parts.push("alt");
  }

  if (event.shiftKey) {
    parts.push("shift");
  }

  const rawKey = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  const alias = SPECIAL_KEY_ALIASES[rawKey] ?? SPECIAL_KEY_ALIASES[event.key] ?? rawKey.toLowerCase();
  parts.push(alias);

  return parts.join("+");
}

function eventHasOnlyModifier(event: KeyboardEvent) {
  return MODIFIER_KEYS.includes(event.key);
}

type RegisteredScope = GlobalHotkeyScope;

type ScopeMap = Map<string, RegisteredScope>;

type ScopeStack = string[];

export function useGlobalHotkeys(): GlobalHotkeysApi {
  const scopesRef = useRef<ScopeMap>(new Map());
  const stackRef = useRef<ScopeStack>([]);

  const sortedScopes = useCallback((): RegisteredScope[] => {
    const scopes = Array.from(scopesRef.current.values());
    if (stackRef.current.length === 0) {
      return scopes.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
    }

    const orderedIds = [...stackRef.current];
    const orderedScopes: RegisteredScope[] = [];
    for (let i = orderedIds.length - 1; i >= 0; i -= 1) {
      const scope = scopesRef.current.get(orderedIds[i]);
      if (scope) {
        orderedScopes.push(scope);
      }
    }

    for (const scope of scopes) {
      if (!orderedIds.includes(scope.id)) {
        orderedScopes.push(scope);
      }
    }

    return orderedScopes;
  }, []);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      if (event.defaultPrevented || eventHasOnlyModifier(event)) {
        return;
      }

      const combo = normalizeKey(event);
      const scopes = sortedScopes();

      for (const scope of scopes) {
        if (scope.isActive && !scope.isActive()) {
          continue;
        }

        const handler = scope.handlers[combo] ?? scope.handlers[event.key] ?? scope.handlers["*"];

        if (!handler) {
          continue;
        }

        const handled = handler(event);

        if (handled) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
      }
    };

    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [sortedScopes]);

  const registerScope = useCallback((scope: GlobalHotkeyScope) => {
    scopesRef.current.set(scope.id, scope);

    return () => {
      scopesRef.current.delete(scope.id);
      stackRef.current = stackRef.current.filter((id) => id !== scope.id);
    };
  }, []);

  const pushScope = useCallback((scopeId: string) => {
    const stack = stackRef.current.filter((id) => id !== scopeId);
    stack.push(scopeId);
    stackRef.current = stack;
  }, []);

  const popScope = useCallback((scopeId?: string) => {
    if (!scopeId) {
      stackRef.current = stackRef.current.slice(0, -1);
      return;
    }

    stackRef.current = stackRef.current.filter((id) => id !== scopeId);
  }, []);

  const clearScopeStack = useCallback(() => {
    stackRef.current = [];
  }, []);

  return useMemo(
    () => ({
      registerScope,
      pushScope,
      popScope,
      clearScopeStack,
    }),
    [registerScope, pushScope, popScope, clearScopeStack],
  );
}

/** Commits, then per component: the thread, list cells, the row a cell draws, bubbles and the composer. */
export interface Renders { commits: number; threadView: number; cells: number; rows: number; bubbles: number; composer: number }

/**
 * Page init script: a stand-in React DevTools hook that counts, per commit, the thread components that
 * actually ran into `window.__renders`. Names are minified, so components are told apart by their props.
 * A row is the element a thread cell draws, the fiber carrying Reanimated's `entering` prop.
 * A fiber rendered when it mounted or carries PerformedWork; a subtree whose child pointer did not
 * change bailed out and is skipped, the same test React DevTools uses.
 */
export const renderCounter = (): void => {
  type Fiber = { tag: number; return: Fiber | null; flags: number; memoizedProps: Record<string, unknown> | null; child: Fiber | null; sibling: Fiber | null; alternate: Fiber | null };
  const w = window as unknown as { __renders: Renders; __REACT_DEVTOOLS_GLOBAL_HOOK__: unknown };
  w.__renders = { commits: 0, threadView: 0, cells: 0, rows: 0, bubbles: 0, composer: 0 };
  const COMPONENT_TAGS = new Set([0, 1, 11, 15]);
  const PERFORMED_WORK = 1;
  const isThreadCell = (props: Record<string, unknown> | null | undefined): boolean =>
    !!props && "cellKey" in props && "renderItem" in props && !!props.item && typeof props.item === "object" && "groupStart" in props.item;
  const kind = (fiber: Fiber, props: Record<string, unknown>): keyof Renders | null => {
    if ("entering" in props) {
      if (fiber.return?.memoizedProps && "entering" in fiber.return.memoizedProps) return null;
      for (let up = fiber.return, depth = 0; up && depth < 10; up = up.return, depth++) if (isThreadCell(up.memoizedProps)) return "rows";
      return null;
    }
    if ("cellKey" in props && "renderItem" in props) {
      const item = props.item as Record<string, unknown> | undefined;
      return item && "groupStart" in item ? "cells" : null;
    }
    if ("onLongPress" in props && "groupStart" in props && "message" in props) return "bubbles";
    if ("onOptimistic" in props && "chatGuid" in props) return "composer";
    if ("jumpTarget" in props && "chatGuid" in props && "isGroup" in props) return "threadView";
    return null;
  };
  const walk = (next: Fiber, prev: Fiber | null): void => {
    if (COMPONENT_TAGS.has(next.tag) && next.memoizedProps && (prev === null || (next.flags & PERFORMED_WORK) !== 0)) {
      const name = kind(next, next.memoizedProps);
      if (name) w.__renders[name]++;
    }
    if (prev !== null && next.child === prev.child) return;
    for (let child = next.child; child; child = child.sibling) walk(child, child.alternate);
  };
  w.__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    isDisabled: false,
    supportsFiber: true,
    renderers: new Map(),
    inject: () => 1,
    checkDCE: () => undefined,
    onCommitFiberUnmount: () => undefined,
    onPostCommitFiberRoot: () => undefined,
    onCommitFiberRoot: (_id: number, root: { current: Fiber }) => {
      w.__renders.commits++;
      walk(root.current, root.current.alternate);
    },
  };
};

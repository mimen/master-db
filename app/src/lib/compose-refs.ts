import * as React from "react"

/**
 * Drop-in replacement for `@radix-ui/react-compose-refs` (aliased in
 * vite.config.ts), fixing an infinite-loop under React 19.
 *
 * Upstream `useComposedRefs(...refs)` is `useCallback(composeRefs(...refs), refs)`.
 * Radix primitives call it as `useComposedRefs(forwardedRef, (node) => setX(node))`
 * with a fresh inline arrow every render, so the memoized callback's identity
 * changes every render. React then detaches/re-attaches the callback ref on
 * every commit (`setX(null)` → `setX(node)`); whenever the subtree also
 * re-renders for any reason, this never settles and trips "Maximum update
 * depth exceeded" (seen via ScrollArea and assorted trigger buttons).
 *
 * Fix: return a STABLE callback (identity never changes) that reads the latest
 * refs from a ref-box. React attaches it once on mount and detaches on unmount,
 * exactly what the state-backed member refs want. `composeRefs` is unchanged.
 */

type PossibleRef<T> = React.Ref<T> | undefined

function setRef<T>(ref: PossibleRef<T>, value: T) {
  if (typeof ref === "function") {
    return ref(value)
  } else if (ref !== null && ref !== undefined) {
    ;(ref as React.MutableRefObject<T>).current = value
  }
}

export function composeRefs<T>(
  ...refs: PossibleRef<T>[]
): (node: T) => void | (() => void) {
  return (node: T) => {
    let hasCleanup = false
    const cleanups = refs.map((ref) => {
      const cleanup = setRef(ref, node)
      if (!hasCleanup && typeof cleanup === "function") {
        hasCleanup = true
      }
      return cleanup
    })
    if (hasCleanup) {
      return () => {
        for (let i = 0; i < cleanups.length; i++) {
          const cleanup = cleanups[i]
          if (typeof cleanup === "function") {
            cleanup()
          } else {
            setRef(refs[i], null)
          }
        }
      }
    }
  }
}

export function useComposedRefs<T>(
  ...refs: PossibleRef<T>[]
): (node: T) => void | (() => void) {
  const refsRef = React.useRef(refs)
  refsRef.current = refs
  return React.useCallback(
    (node: T) => composeRefs(...refsRef.current)(node),
    [],
  )
}

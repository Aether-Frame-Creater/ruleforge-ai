import * as React from "react"

const MOBILE_BREAKPOINT = 768

const QUERY = `(max-width: ${MOBILE_BREAKPOINT - 1}px)`

function subscribe(onChange: () => void) {
  const mql = window.matchMedia(QUERY)
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

/**
 * Tracks the mobile breakpoint.
 *
 * `useSyncExternalStore` rather than state-plus-effect: the viewport is an
 * external store, and subscribing to it directly avoids the extra render pass
 * (and the lint rule) that setting state from an effect causes.
 */
export function useIsMobile() {
  return React.useSyncExternalStore(
    subscribe,
    () => window.matchMedia(QUERY).matches,
    // Server render: assume desktop, matching the previous `!!undefined`.
    () => false,
  )
}

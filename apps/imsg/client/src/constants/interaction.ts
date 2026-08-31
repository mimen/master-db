// The app-wide hover language for filled/accent surfaces (send buttons, chips,
// banner actions): hover dims to HOVER_DIM, pressed steps one further to
// PRESS_DIM. Fill-based controls (rows, icon buttons) step through
// backgroundElement → backgroundSelected instead and never use opacity.
//
// Pure module (no react-native import) so bun-test-loaded helpers like
// chrome-control-fill.ts can depend on it.
export const HOVER_DIM = 0.82;
export const PRESS_DIM = 0.72;

/// <reference types="expo/types" />

// Tracked counterpart to expo-env.d.ts, which Expo generates and gitignores.
//
// The client tsconfig includes expo-env.d.ts, so a checkout that has it picks up
// Expo's augmentations, including the `hovered` member on
// PressableStateCallbackType that this codebase uses throughout. A fresh
// checkout has no such file, so CI and every new worktree instead fail
// `typecheck:imsg` with ~109 TS2339 errors in components nobody edited.
//
// This file carries the same reference under version control so the typecheck
// result does not depend on whether Expo's CLI has been run in that checkout.

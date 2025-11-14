/**
 * Export Convex modules for testing
 * import.meta.glob works here because this file is processed by Vite during testing
 */

// This will be transformed at build time by Vite
export const modules = import.meta.glob("./**/*.*s", { eager: false });

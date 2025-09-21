// Global type declarations for Convex environment

declare global {
  // Web Crypto API is available in Convex
  const crypto: {
    randomUUID(): string;
  };
}

export {};
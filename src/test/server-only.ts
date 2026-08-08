// Vitest runs in Node and intentionally exercises server-only modules. Next.js
// replaces this marker during its own build, so tests alias the throwing npm
// sentinel to this empty module without weakening the production boundary.
export {};

import { defineConfig } from 'vitest/config';

// Kept apart from vite.config.ts rather than merged into it: vitest re-exports
// its own `defineConfig`, and feeding it the Vite 8 React plugin is a type
// mismatch across major versions. Tests need neither the plugin nor fast
// refresh — esbuild's automatic JSX runtime is enough to render components.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./test/setup.ts'],
    include: ['test/**/*.test.{ts,tsx}'],
  },
});

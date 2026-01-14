import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/**',
        'dist/**',
        '**/*.test.{ts,tsx}',
        'src/test/**',
        'vitest.config.ts',
        'vite.config.ts',
        'postcss.config.js',
        'tailwind.config.js',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/types/**',  // Type definitions only
        'src/components/ui/**',  // UI primitives from shadcn
        'src/hooks/**',  // External hook patterns
      ],
      thresholds: {
        statements: 100,
        branches: 90,
        functions: 90,
        lines: 100,
      },
    },
  },
});

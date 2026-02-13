import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['public/js/**/*.js'],
      exclude: ['public/js/**/*.test.js', 'public/js/**/__tests__/**'],
      all: true,
      thresholds: {
        lines: 3,
        functions: 60,
        branches: 70,
        statements: 3,
      },
    },
    include: ['public/js/**/*.test.js', 'public/js/__tests__/**/*.js'],
    setupFiles: ['./test-setup.js'],
  },
})

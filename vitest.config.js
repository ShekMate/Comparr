import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html', 'lcov'],
      include: ['public/js/**/*.js'],
      exclude: ['public/js/**/*.test.js', 'tests/**'],
      all: true,
      lines: 60,
      functions: 60,
      branches: 60,
      statements: 60,
    },
    include: ['public/js/**/*.test.js', 'tests/**/*.test.js'],
    setupFiles: ['./test-setup.js'],
  },
})

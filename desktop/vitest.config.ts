import { resolve } from 'path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@lcl': resolve(__dirname, '../lcl'),
      '@': resolve(__dirname, 'frontend/src'),
      '@amadeus-shared': resolve(__dirname, 'shared/amadeus'),
      '@amadeus': resolve(__dirname, 'frontend/src/amadeus'),
    },
  },
  test: {
    environment: 'node',
    include: ['frontend/src/**/*.test.ts', 'electron/**/*.test.ts', 'shared/**/*.test.ts', 'products/**/*.test.ts', '../lcl/engine/**/*.test.ts', '../lcl/spaces/**/*.test.ts'],
  },
})

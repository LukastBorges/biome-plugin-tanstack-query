import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Each test spawns the Biome CLI; give slow CI runners some headroom.
    testTimeout: 30_000,
  },
})

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'engine', root: 'packages/engine', include: ['test/**/*.test.ts'] } },
      { test: { name: 'cli', root: 'packages/cli', include: ['test/**/*.test.ts'] } },
      { test: { name: 'site', root: 'site', include: ['test/**/*.test.ts'] } },
      {
        test: {
          name: 'player',
          root: 'packages/player',
          include: ['test/**/*.test.ts'],
          passWithNoTests: true,
        },
      },
    ],
  },
});

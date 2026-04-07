import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      include: [
        'lib/**/*.ts',
        'models/**/*.ts',
        'forms/**/*.ts',
      ],
      exclude: [
        'lib/db.ts',
        'lib/config.ts',
        'lib/uploads.ts',
        'lib/email.ts',
        '**/*.d.ts',
        '**/node_modules/**',
        '**/prisma/**',
      ],
      thresholds: {
        'lib/gstr1.ts': {
          statements: 80,
          branches: 70,
          functions: 78,
          lines: 80,
        },
        'lib/gstr3b.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
        'lib/export.ts': {
          statements: 80,
          branches: 70,
          functions: 80,
          lines: 80,
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
})

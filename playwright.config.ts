import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  expect: { timeout: 15000 },
  use: {
    baseURL: 'http://localhost:3100',
    headless: true,
  },
  webServer: {
    command: 'NODE_ENV=development PORT=3100 LBW_DATA_DIR=/tmp/opencode/lbw-test-world npx tsx server/index.ts',
    port: 3100,
    timeout: 60000,
  },
});

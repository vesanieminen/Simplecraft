import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  timeout: 45000,
  expect: { timeout: 15000 },
  // CI splits the suite with `--shard=i/4`. Test-level sharding only happens
  // when tests may run independently — without this, one spec file is a
  // single serial chain that lands wholly in one shard (verified: 42/0/0/0).
  fullyParallel: true,
  // ...but nothing actually runs at the same time: every test shares one dev
  // server and one world-save directory, so side-by-side tests would stomp
  // on each other's saves (same failure class as the reset-world flake).
  // The parallelism lives in CI's separate VMs, not here. One worker also
  // keeps `npm test` local runs exactly as deterministic as they were.
  workers: 1,
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

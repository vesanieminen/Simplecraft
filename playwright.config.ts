import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // CI VMs are sometimes starved neighbours running at roughly half speed
  // (observed: a 9-minute shard taking 18.5, and a healthy-49s test timing
  // out at 45s on a loaded box). CI gets double the clocks across the board;
  // test.slow() markers then add headroom on top of that.
  timeout: process.env.CI ? 90000 : 45000,
  expect: { timeout: process.env.CI ? 25000 : 15000 },
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
  // the html reporter fills playwright-report/, which the CI job uploads on
  // failure — without it the artifact was always empty and a red shard gave
  // away nothing beyond the exit code
  reporter: [['list'], ['html', { open: 'never' }]],
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

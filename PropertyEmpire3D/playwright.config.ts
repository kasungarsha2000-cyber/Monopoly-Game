import { defineConfig, devices } from '@playwright/test';

const PORT = Number(process.env.PE_E2E_PORT ?? 3201);

export default defineConfig({
  testDir: 'tests/e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  workers: 1,
  fullyParallel: false,
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    launchOptions: {
      // Software WebGL so tests run on machines without a GPU.
      args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
    }
  },
  webServer: {
    // Serves the production web build and the LAN WebSocket server on one port.
    command: `node apps/server/dist/index.js --port ${PORT} --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}/health`,
    reuseExistingServer: false,
    timeout: 30_000,
    env: { PE_BOT_DELAY_MS: '120', PE_SAVE_DIR: 'test-results/e2e-saves' }
  },
  projects: [
    { name: 'desktop-chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 820 } }, testIgnore: /(mobile|android)\.spec/ },
    { name: 'mobile-chromium', use: { ...devices['Pixel 7'] }, testMatch: /(mobile|android)\.spec/ }
  ]
});

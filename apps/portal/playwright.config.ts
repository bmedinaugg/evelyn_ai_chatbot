import { defineConfig, devices } from '@playwright/test';

const PORT = 4176;

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  reporter: 'list',
  // Support staff are Dutch by default; the English switch has its own test.
  use: { baseURL: `http://localhost:${PORT}`, trace: 'retain-on-failure', locale: 'nl-NL' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}/portal/`,
    reuseExistingServer: false,
  },
});

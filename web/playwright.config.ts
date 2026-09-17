import { defineConfig } from '@playwright/test';

// 联调 E2E：默认访问 compose 映射到宿主的 web 端口；
// 容器内由 verify 服务通过 E2E_BASE_URL=http://web 覆盖。
const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:8080';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  expect: { timeout: 10_000 },
  retries: 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL,
    actionTimeout: 10_000,
  },
});

import { defineConfig, devices } from '@playwright/test';

const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://127.0.0.1:5173';

export default defineConfig({
    testDir: './tests/e2e',
    outputDir: './output/playwright/test-results',
    fullyParallel: true,
    forbidOnly: Boolean(process.env.CI),
    retries: process.env.CI ? 2 : 0,
    reporter: [
        [ 'list' ],
        [ 'html', { open: 'never', outputFolder: './output/playwright/report' } ]
    ],
    use: {
        baseURL,
        trace: 'retain-on-failure',
        screenshot: 'only-on-failure',
        video: 'retain-on-failure'
    },
    webServer: {
        command: process.env.PLAYWRIGHT_WEB_SERVER_COMMAND ?? 'npm run dev',
        url: process.env.PLAYWRIGHT_WEB_SERVER_URL ?? baseURL,
        reuseExistingServer: !process.env.CI,
        timeout: 120_000
    },
    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
        { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
        { name: 'webkit', use: { ...devices['Desktop Safari'] } },
        { name: 'mobile-chrome', use: { ...devices['Pixel 7'] } },
        { name: 'mobile-safari', use: { ...devices['iPhone 14'] } }
    ]
});

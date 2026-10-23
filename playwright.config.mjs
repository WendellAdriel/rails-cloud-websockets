import { defineConfig } from '@playwright/test';
export default defineConfig({
    testDir: './test/browser',
    workers: 1,
    outputDir: '/results/artifacts',
    timeout: 60000,
    expect: { timeout: 20000 },
    use: {
        baseURL: process.env.DEMO_URL || 'https://cloud-ws.localhost:3443',
        ignoreHTTPSErrors: true,
        launchOptions: { args: ['--ignore-certificate-errors'] },
        screenshot: 'only-on-failure',
        trace: 'retain-on-failure',
    },
    reporter: [['list'], ['json', { outputFile: `/results/${process.env.REPORT_NAME || 'browser'}.json` }]],
});

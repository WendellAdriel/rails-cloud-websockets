import config from './playwright.config.mjs';
export default {
    ...config,
    testDir: './test/readiness',
    projects: [
        { name: 'chromium', use: { browserName: 'chromium' } },
        { name: 'firefox', use: { browserName: 'firefox', launchOptions: {} } },
        { name: 'webkit', use: { browserName: 'webkit', launchOptions: {} } },
    ],
};

import config from './playwright.config.mjs';
export default {
    ...config,
    grep: /channel actions|model callbacks|full page navigation/,
    use: { ...config.use, launchOptions: {} },
    projects: [
        { name: 'firefox', use: { browserName: 'firefox' } },
        { name: 'webkit', use: { browserName: 'webkit' } },
    ],
};

import config from "./playwright.config.mjs";
export default { ...config, testDir: "./test/readiness" };

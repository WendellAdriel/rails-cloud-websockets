import { test, expect } from '@playwright/test';

test('release gate: the AnyCable extended protocol accepts connections', async ({ page }) => {
    await page.goto('/?client=anycable&protocol=actioncable-v1-ext-json');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
});

test('release gate: reconnect catches up broadcasts missed while the browser was offline', async ({ page, context, browser }) => {
    const sender = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
        await page.goto('/?client=anycable');
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
        const senderPage = await sender.newPage();
        await senderPage.goto(`${process.env.DEMO_URL || 'https://cloud-ws.localhost:3443'}/`);
        await expect(senderPage.locator('#status')).toHaveAttribute('data-connected', 'true');
        await context.setOffline(true);
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'false');
        const text = `missed-${Date.now()}`;
        await senderPage.locator('#message').fill(text);
        await senderPage.locator('#send').click();
        await expect(senderPage.locator('#messages')).toContainText(text);
        await context.setOffline(false);
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
        await expect(page.locator('#messages')).toContainText(text);
    } finally { await sender.close(); }
});

test('release gate: the AnyCable presence API returns the current channel presence', async ({ page }) => {
    await page.goto('/?client=anycable&protocol=actioncable-v1-ext-json');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    const presence = await page.evaluate(() => window.lab.room.presence.info());
    expect(presence).toBeDefined();
});

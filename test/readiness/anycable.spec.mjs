import { test, expect } from '@playwright/test';

test('release gate: the AnyCable extended protocol accepts connections', async ({ page }) => {
    const requests = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/__laravel_cloud/cable')) requests.push(request.postDataJSON()); });
    await page.goto('/?client=anycable&protocol=actioncable-v1-ext-json');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    expect(requests.some(request => request.command === 'connect' && request.protocol === 'actioncable-v1-ext-json')).toBe(true);
});

test('release gate: reconnect catches up broadcasts missed while the browser was offline', async ({ page, context, browser }) => {
    const sender = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
        await page.goto('/?client=anycable&protocol=actioncable-v1-ext-json');
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
    await page.locator('#broker-presence').click();
    await expect(page.locator('#messages')).toContainText('presence:');
    const presence = await page.evaluate(() => window.lab.room.presence.info());
    expect(Object.keys(presence).length).toBeGreaterThan(0);
    await page.locator('#server-presence').click();
    await expect(page.locator('#messages')).toContainText('server presence:');
    await page.locator('#broker-leave').click();
});


test('SDK protocol pongs do not create an HTTP heartbeat per browser', async ({ page }) => {
    const commands = [];
    page.on('request', request => { if (request.method() === 'POST' && request.url().endsWith('/__laravel_cloud/cable')) commands.push(request.postDataJSON().command); });
    await page.goto('/?client=anycable&protocol=actioncable-v1-ext-json&pongs=1');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    expect(await page.evaluate(() => window.lab.consumer.protocol.sendPongs)).toBe(true);
    await page.evaluate(() => new Promise(resolve => {
        let count = 0;
        const unsubscribe = window.lab.consumer.on('keepalive', time => {
            if (typeof time !== 'number' || ++count < 2) return;
            unsubscribe();
            resolve();
        });
    }));
    await page.locator('#message').fill('after protocol pongs');
    await page.locator('#send').click();
    await expect(page.locator('#messages')).toContainText('after protocol pongs');
    expect(commands.filter(command => command === 'pong')).toHaveLength(0);
});

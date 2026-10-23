import { test, expect } from '@playwright/test';
import { writeFile, access } from 'node:fs/promises';

async function fault(service) {
    const id = `${service}-${Date.now()}`;
    await writeFile('/results/fault-request.json', JSON.stringify({ id, service }));
    await expect.poll(async () => {
        try { await access(`/results/${id}.done`); return true; } catch { return false; }
    }, { timeout: 45000 }).toBe(true);
}

for (const service of ['workers', 'reverb']) {
    test(`extended replay survives loss of all ${service} connections`, async ({ page, context, browser }) => {
        test.setTimeout(120000);
        const sender = await browser.newContext({ ignoreHTTPSErrors: true });
        try {
            await page.goto('/?client=anycable&protocol=actioncable-v1-ext-json');
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            const senderPage = await sender.newPage();
            await senderPage.goto(`${process.env.DEMO_URL || 'https://cloud-ws.localhost:3443'}/`);
            await expect(senderPage.locator('#status')).toHaveAttribute('data-connected', 'true');
            await context.setOffline(true);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'false');
            const previous = await senderPage.evaluate(() => window.lab.connectedCount);
            await fault(service);
            await expect.poll(() => senderPage.evaluate(() => window.lab.connectedCount), { timeout: 45000 }).toBeGreaterThan(previous);
            const messages = Array.from({ length: 3 }, (_, index) => `retained-${service}-${Date.now()}-${index}`);
            for (const text of messages) {
                await senderPage.evaluate(text => window.lab.request('/broadcast', { text }), text);
            }
            await context.setOffline(false);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            for (const text of messages) await expect(page.locator('#messages')).toContainText(text);
            const live = `after-history-${Date.now()}`;
            await page.locator('#message').fill(live);
            await page.locator('#send').click();
            await expect(page.locator('#messages')).toContainText(live);
            for (const text of messages) expect(await page.evaluate(text => window.lab.messages.filter(message => message.text === text).length, text)).toBe(1);
        } finally { await sender.close(); }
    });
}

test('lost Valkey history emits history_not_found and permits fresh live delivery', async ({ page, context, browser }) => {
    test.setTimeout(120000);
    const sender = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
        await page.goto('/?client=anycable&protocol=actioncable-v1-ext-json');
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
        await page.evaluate(() => {
            window.lab.historyMisses = 0;
        });
        const before = `before-cache-loss-${Date.now()}`;
        await page.locator('#message').fill(before);
        await page.locator('#send').click();
        await expect(page.locator('#messages')).toContainText(before);
        await context.setOffline(true);
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'false');
        await fault('valkey');
        const senderPage = await sender.newPage();
        await senderPage.goto(`${process.env.DEMO_URL || 'https://cloud-ws.localhost:3443'}/`);
        await expect(senderPage.locator('#status')).toHaveAttribute('data-connected', 'true');
        await senderPage.evaluate(() => window.lab.request('/broadcast', { text: 'new cache epoch' }));
        await context.setOffline(false);
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true', { timeout: 45000 });
        await expect.poll(() => page.evaluate(() => window.lab.historyMisses)).toBeGreaterThan(0);
        const text = `fresh-after-cache-loss-${Date.now()}`;
        await page.locator('#message').fill(text);
        await page.locator('#send').click();
        await expect(page.locator('#messages')).toContainText(text);
    } finally { await sender.close(); }
});


test('SDK presence membership rejoins after workers and Reverb restart', async ({ page, browser }) => {
    test.setTimeout(150000);
    const memberContext = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
        await page.goto('/?client=anycable&protocol=actioncable-v1-ext-json');
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
        const member = await memberContext.newPage();
        await member.goto(`${process.env.DEMO_URL || 'https://cloud-ws.localhost:3443'}/?client=anycable&protocol=actioncable-v1-ext-json`);
        await expect(member.locator('#status')).toHaveAttribute('data-connected', 'true');
        await member.evaluate(() => window.lab.room.presence.join('sdk-member', { name: 'SDK member' }));
        await expect.poll(() => page.evaluate(async () => (await window.lab.room.presence.info())['sdk-member']?.name)).toBe('SDK member');
        for (const service of ['workers', 'reverb']) {
            const previous = await member.evaluate(() => window.lab.connectedCount);
            await fault(service);
            await expect.poll(() => member.evaluate(() => window.lab.connectedCount), { timeout: 45000 }).toBeGreaterThan(previous);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            await expect.poll(() => page.evaluate(async () => (await window.lab.room.presence.info())['sdk-member']?.name), { timeout: 30000 }).toBe('SDK member');
        }
        await member.evaluate(() => window.lab.room.presence.leave());
        await expect.poll(() => page.evaluate(async () => (await window.lab.room.presence.info())['sdk-member'])).toBeUndefined();
    } finally { await memberContext.close(); }
});

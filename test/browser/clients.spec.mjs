import { test, expect } from '@playwright/test';

for (const client of ['actioncable', 'anycable']) {
    test.describe(client, () => {
        test('channel actions, direct replies, custom coders, model streams, timers, and presence', async ({ page }) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            await page.goto(`/?client=${client}`);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            await page.locator('#message').fill(`hello-${client}`);
            await page.locator('#send').click();
            await expect.poll(() => page.evaluate(() => window.lab.messages.filter(message => message.kind === 'broadcast').length)).toBe(1);
            await page.locator('#direct').click();
            await expect(page.locator('#messages')).toContainText(`direct: hello-${client}`);
            await page.locator('#broadcast').click();
            await expect(page.locator('#messages')).toContainText(`controller: hello-${client}`);
            await page.locator('#custom').click();
            await expect(page.locator('#messages')).toContainText(`custom: HELLO-${client.toUpperCase()}`);
            await page.locator('#model').click();
            await expect(page.locator('#messages')).toContainText(`model: hello-${client}`);
            await page.locator('#timer').click();
            await expect.poll(() => page.evaluate(() => window.lab.messages.some(message => message.kind === 'tick'))).toBe(true);
            await page.locator('#presence').click();
            await expect.poll(() => page.evaluate(() => window.lab.messages.some(message => message.kind === 'presence' && message.count > 0))).toBe(true);
            await page.locator('#whisper').click();
            await expect(page.locator('#messages')).toContainText(`whisper: hello-${client}`);
            expect(errors).toEqual([]);
        });

        test('model callbacks render Turbo Streams under the content security policy', async ({ page }) => {
            const errors = [];
            page.on('pageerror', error => errors.push(error.message));
            const response = await page.goto(`/?client=${client}`);
            expect(response.headers()['content-security-policy']).toContain("script-src 'self'");
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            await expect(page.locator('turbo-cable-stream-source')).toHaveAttribute('connected', '');
            await page.locator('#message').fill(`Report ${client} ${Date.now()}`);
            const title = await page.locator('#message').inputValue();
            await page.locator('#report').click();
            await expect(page.locator('#reports')).toContainText(title);
            await page.getByRole('link', { name: 'Turbo navigation' }).click();
            await expect(page.locator('h1')).toHaveText('Turbo navigation');
            await page.getByRole('link', { name: 'Back to the lab' }).click();
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            await page.locator('#send').click();
            await expect.poll(() => page.evaluate(() => window.lab.messages.filter(message => message.kind === 'broadcast').length)).toBe(1);
            expect(errors).toEqual([]);
        });

        test('unsubscribe, reconnect, and browser network interruption recover without duplicate delivery', async ({ page, context }) => {
            await page.goto(`/?client=${client}`);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            await page.locator('#unsubscribe').click();
            await expect(page.locator('#status')).toHaveText('Unsubscribed');
            await page.locator('#subscribe').click();
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            await page.locator('#reconnect').click();
            await expect.poll(() => page.evaluate(() => window.lab.connectedCount)).toBeGreaterThanOrEqual(3);
            await context.setOffline(true);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'false');
            await context.setOffline(false);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            await page.locator('#message').fill('after network recovery');
            await page.locator('#send').click();
            await expect.poll(() => page.evaluate(() => window.lab.messages.filter(message => message.text === 'after network recovery').length)).toBe(1);
        });

        test('logout and permission revocation stop the browser connection', async ({ page }) => {
            await page.goto(`/?client=${client}`);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            await page.locator('#revoke').click();
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'false');
            const audit = await page.request.get('/audit');
            expect((await audit.json()).events.disconnect).toBeGreaterThanOrEqual(1);
        });
    });
}

test('Action Cable and AnyCable exchange broadcasts across independent browser sessions', async ({ browser }) => {
    const first = await browser.newContext({ ignoreHTTPSErrors: true });
    const second = await browser.newContext({ ignoreHTTPSErrors: true });
    try {
        const one = await first.newPage();
        const two = await second.newPage();
        await one.goto(`${process.env.DEMO_URL || 'https://cloud-ws.localhost:3443'}/?client=actioncable`);
        await two.goto(`${process.env.DEMO_URL || 'https://cloud-ws.localhost:3443'}/?client=anycable`);
        for (const page of [one, two]) await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
        await one.locator('#message').fill('across client libraries');
        await one.locator('#send').click();
        await expect(two.locator('#messages')).toContainText('across client libraries');
        await two.locator('#message').fill('reply from AnyCable');
        await two.locator('#send').click();
        await expect(one.locator('#messages')).toContainText('reply from AnyCable');
        await one.locator('#message').fill('only to sender');
        await one.locator('#direct').click();
        await expect(one.locator('#messages')).toContainText('only to sender');
        await expect(two.locator('#messages')).not.toContainText('only to sender');
    } finally { await first.close(); await second.close(); }
});

test('shared heartbeats and sparse leases keep sustained connections alive', async ({ page }) => {
    test.setTimeout(90000);
    let commands = 0;
    await page.goto('/?client=anycable');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    await page.waitForTimeout(500);
    page.on('request', request => { if (request.url().endsWith('/__laravel_cloud/cable')) commands += 1; });
    await page.waitForTimeout(65000);
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    expect(commands).toBeGreaterThanOrEqual(2);
    expect(commands).toBeLessThanOrEqual(6);
});

test('a Web Worker uses the native Rails transport without injected bridge code', async ({ page }) => {
    await page.goto('/?client=anycable');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    await page.locator('#message').fill('outside the HTML transport');
    await page.locator('#worker').click();
    await expect.poll(() => page.evaluate(() => window.lab.workerEvents?.some(event => event.kind === 'worker_ready' && event.bridgeInjected === false))).toBe(true);
    await expect(page.locator('#messages')).toContainText('worker: outside the HTML transport');
});

test('unrelated native WebSockets retain their normal constructor and event behavior', async ({ page }) => {
    await page.goto('/');
    const result = await page.evaluate(() => new Promise((resolve, reject) => {
        const config = globalThis.__laravelCloudWebsockets;
        const socket = new WebSocket(`${config.scheme === 'https' ? 'wss' : 'ws'}://${config.host}:${config.port}/app/${config.key}?protocol=7&client=unrelated&version=1`);
        socket.addEventListener('error', reject);
        socket.addEventListener('message', event => {
            const value = { native: !('transport' in socket), instance: socket instanceof WebSocket, event: JSON.parse(event.data).event };
            socket.close();
            resolve(value);
        }, { once: true });
    }));
    expect(result).toEqual({ native: true, instance: true, event: 'pusher:connection_established' });
});

for (const client of ['actioncable', 'anycable']) {
    test(`${client} isolates subscriptions sharing one stream in the same connection`, async ({ page }) => {
        await page.goto(`/?client=${client}`);
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
        await page.evaluate(async client => {
            window.sharedMessages = [[], []];
            window.sharedSubscriptions = await Promise.all([0, 1].map(index => new Promise(resolve => {
                const params = { room: 'demo', tag: `shared-${index}` };
                if (client === 'anycable') {
                    const channel = window.lab.consumer.subscribeTo('RoomChannel', params);
                    channel.on('message', message => window.sharedMessages[index].push(message));
                    channel.on('connect', () => resolve(channel));
                } else {
                    const channel = window.lab.consumer.subscriptions.create({ channel: 'RoomChannel', ...params }, {
                        connected() { resolve(channel); },
                        received(message) { window.sharedMessages[index].push(message); },
                    });
                }
            })));
        }, client);
        await page.locator('#message').fill('shared stream first');
        await page.locator('#send').click();
        await expect.poll(() => page.evaluate(() => window.sharedMessages.map(messages => messages.filter(message => message.text === 'shared stream first').length))).toEqual([1, 1]);
        await page.evaluate(client => client === 'anycable' ? window.sharedSubscriptions[0].disconnect() : window.sharedSubscriptions[0].unsubscribe(), client);
        await page.waitForTimeout(300);
        await page.locator('#message').fill('shared stream second');
        await page.locator('#send').click();
        await expect.poll(() => page.evaluate(() => window.sharedMessages.map(messages => messages.filter(message => message.text === 'shared stream second').length))).toEqual([0, 1]);
    });
}

test('full page navigation promptly releases all Rails connections', async ({ page }) => {
    await page.goto('/?client=anycable');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    await expect(page.locator('turbo-cable-stream-source')).toHaveAttribute('connected', '');
    const before = (await (await page.request.get('/audit')).json()).events.connect;
    await page.goto('/about');
    await expect.poll(async () => (await (await page.request.get('/audit')).json()).events.disconnect || 0, { timeout: 5000 }).toBeGreaterThanOrEqual(before);
});

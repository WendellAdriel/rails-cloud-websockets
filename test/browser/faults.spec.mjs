import { test, expect } from '@playwright/test';
import { writeFile, access } from 'node:fs/promises';

async function fault(service) {
    const id = `${service}-${Date.now()}`;
    await writeFile('/results/fault-request.json', JSON.stringify({ id, service }));
    await expect.poll(async () => {
        try { await access(`/results/${id}.done`); return true; } catch { return false; }
    }, { timeout: 45000 }).toBe(true);
}

for (const client of ['actioncable', 'anycable']) {
    test(`${client} recovers after Reverb and Rails workers restart`, async ({ page }) => {
        test.setTimeout(180000);
        await page.goto(`/?client=${client}`);
        await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
        for (const service of ['reverb', 'workers']) {
            const previous = await page.evaluate(() => window.lab.connectedCount);
            await fault(service);
            await expect.poll(() => page.evaluate(() => window.lab.connectedCount), { timeout: 45000 }).toBeGreaterThan(previous);
            await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
            const text = `after-${service}-${client}`;
            await page.locator('#message').fill(text);
            await page.locator('#send').click();
            await expect.poll(() => page.evaluate(text => window.lab.messages.filter(message => message.text === text).length, text)).toBe(1);
        }
    });
}

test('delayed HTTP acknowledgements do not interrupt delivery or create duplicates', async ({ page }) => {
    await page.goto('/?client=anycable');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    let acknowledged = false;
    await page.route('**/__laravel_cloud/cable', async route => {
        const body = route.request().postDataJSON();
        const response = await route.fetch();
        if (body.command === 'message') await new Promise(resolve => setTimeout(resolve, 2500));
        await route.fulfill({ response });
        acknowledged = true;
    });
    await page.locator('#message').fill('delayed response');
    await page.locator('#send').click();
    await expect.poll(() => page.evaluate(() => window.lab.messages.filter(message => message.text === 'delayed response').length)).toBe(1);
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    await expect.poll(() => acknowledged).toBe(true);
});

test('throttled browser timers release Rails sessions and reconnect when resumed', async ({ page, context }) => {
    test.setTimeout(160000);
    await page.addInitScript(() => {
        const timeout = window.setTimeout.bind(window);
        const interval = window.setInterval.bind(window);
        const clearTimeout = window.clearTimeout.bind(window);
        const clearInterval = window.clearInterval.bind(window);
        const pending = new Map();
        let paused = false;
        for (const [name, native] of [['setTimeout', timeout], ['setInterval', interval]]) {
            window[name] = (callback, duration, ...args) => {
                let id;
                id = native(() => {
                    const invoke = () => callback(...args);
                    if (paused) pending.set(id, invoke);
                    else invoke();
                }, duration);
                return id;
            };
        }
        window.clearTimeout = id => { pending.delete(id); clearTimeout(id); };
        window.clearInterval = id => { pending.delete(id); clearInterval(id); };
        window.pauseDemoTimers = value => {
            paused = value;
            if (!paused) {
                const tasks = [...pending.values()];
                pending.clear();
                for (const task of tasks) task();
            }
        };
    });
    await page.goto('/?client=anycable');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    const before = (await (await page.request.get('/audit')).json()).events;
    const expectedDisconnects = before.connect;
    await page.evaluate(() => window.pauseDemoTimers(true));
    await expect.poll(async () => {
        const audit = await (await page.request.get('/audit')).json();
        return audit.events.disconnect || 0;
    }, { timeout: 120000, intervals: [1000, 3000] }).toBeGreaterThanOrEqual(expectedDisconnects);
    await page.evaluate(() => window.pauseDemoTimers(false));
    await expect.poll(() => page.evaluate(() => window.lab.connectedCount), { timeout: 30000 }).toBeGreaterThan(1);
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    await page.locator('#message').fill('resumed tab');
    await page.locator('#send').click();
    await expect(page.locator('#messages')).toContainText('resumed tab');
});

test('native Web Worker clients recover when the Reverb subscription bus restarts', async ({ page }) => {
    test.setTimeout(90000);
    await page.goto('/?client=anycable');
    await expect(page.locator('#status')).toHaveAttribute('data-connected', 'true');
    await page.locator('#message').fill('native before restart');
    await page.locator('#worker').click();
    await expect(page.locator('#messages')).toContainText('worker: native before restart');
    const before = await page.evaluate(() => window.lab.workerEvents.filter(event => event.kind === 'worker_ready').length);
    await fault('reverb');
    await expect.poll(() => page.evaluate(() => window.lab.workerEvents.filter(event => event.kind === 'worker_ready').length), { timeout: 30000 }).toBeGreaterThan(before);
    await page.locator('#message').fill('native after restart');
    await page.locator('#worker').click();
    await expect(page.locator('#messages')).toContainText('worker: native after restart');
});

import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { base, client, delay, until } from './client.mjs';

const count = Number(process.env.CLIENTS || 200);
const rounds = Number(process.env.ROUNDS || 10);
const cables = [];
const latencies = [];
const prefix = `load-${randomUUID()}`;
const seen = new Map();

async function pool(items, operation, concurrency = 8) {
    let next = 0;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < items.length) {
            const index = next++;
            await operation(items[index], index);
        }
    }));
}

async function workers() {
    const records = new Map();
    for (let index = 0; index < 32; index++) {
        const record = await (await fetch(`${base}/up?run=${encodeURIComponent(prefix)}`, { headers: { Connection: 'close' } })).json();
        records.set(`${record.replica}:${record.worker}`, record);
    }
    return [...records.values()];
}

const start = performance.now();
const before = await workers();
try {
    await pool(Array.from({ length: count }), async (_, index) => {
        const cable = await client({ run: prefix });
        cables.push(cable);
        await cable.subscribe();
        cable.socket.addEventListener('message', event => {
            const envelope = JSON.parse(event.data);
            if (envelope.event !== 'cloud-frame') return;
            const data = typeof envelope.data === 'string' ? JSON.parse(envelope.data) : envelope.data;
            const text = data.frame.message?.text;
            if (!text?.startsWith(prefix)) return;
            const key = `${index}:${text}`;
            seen.set(key, (seen.get(key) || 0) + 1);
            latencies.push(Date.now() - Number(text.split(':').at(-1)));
        });
    });
    const connectedAt = performance.now();
    for (let round = 0; round < rounds; round++) {
        const text = `${prefix}-${round}:${Date.now()}`;
        assert.equal((await cables[0].post('/broadcast', { text })).status, 204);
        await until(() => [...seen.keys()].filter(key => key.endsWith(text)).length === count, `fanout round ${round}`, 30000);
    }
    assert.equal(seen.size, count * rounds);
    assert.ok([...seen.values()].every(value => value === 1), 'duplicate deliveries');
    latencies.sort((left, right) => left - right);
    const connectedWorkers = await workers();
    await pool(cables, async cable => { assert.equal((await cable.close())?.status, 200, "disconnect acknowledgement"); });
    cables.length = 0;
    let after;
    await until(async () => {
        after = await workers();
        return after.length >= before.length && after.every(record => record.run_connections === 0);
    }, 'connection cleanup', 15000);
    console.log(JSON.stringify({ clients: count, rounds, deliveries: seen.size, duplicates: 0, connectSeconds: Number(((connectedAt - start) / 1000).toFixed(2)), totalSeconds: Number(((performance.now() - start) / 1000).toFixed(2)), latencyMs: { p50: latencies[Math.floor(latencies.length * .50)], p95: latencies[Math.floor(latencies.length * .95)], max: latencies.at(-1) }, workersBefore: before, workersConnected: connectedWorkers, workersAfter: after }, null, 2));
} finally {
    await pool(cables, cable => cable.close());
}

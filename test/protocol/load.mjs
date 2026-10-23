import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { base, client, until } from './client.mjs';

const count = Number(process.env.CLIENTS || 200);
const rounds = Number(process.env.ROUNDS || 10);
const burst = Number(process.env.BURST || 1);
const protocol = process.env.PROTOCOL || 'actioncable-v1-json';
const cables = [];
const latencies = [];
const prefix = `load-${randomUUID()}`;
const seen = new Map();

async function pool(items, operation, concurrency = 8) {
    let next = 0;
    let failure;
    await Promise.all(Array.from({ length: concurrency }, async () => {
        while (next < items.length && !failure) {
            const index = next++;
            try {
                await operation(items[index], index);
            } catch (error) {
                failure ||= error;
            }
        }
    }));
    if (failure) throw failure;
}

function progress(data) {
    if (process.env.LOAD_PROGRESS) console.error(JSON.stringify({ ...data, at: new Date().toISOString() }));
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
        const cable = await client({ run: prefix, protocol });
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
    progress({ phase: 'connected', clients: count });
    const deliveryStart = performance.now();
    await pool(Array.from({ length: rounds }), async (_, round) => {
        const text = `${prefix}-${round}:${Date.now()}`;
        assert.equal((await cables[0].post('/broadcast', { text })).status, 204);
        await until(() => [...seen.keys()].filter(key => key.endsWith(text)).length === count, `fanout round ${round}`, 30000);
        progress({ phase: 'delivered', round, clients: count });
    }, burst);
    const deliverySeconds = (performance.now() - deliveryStart) / 1000;
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
    console.log(JSON.stringify({
        clients: count, rounds, burst, protocol,
        deliverySeconds: Number(deliverySeconds.toFixed(2)),
        deliveriesPerSecond: Number((seen.size / deliverySeconds).toFixed(2)),
        deliveries: seen.size, duplicates: 0,
        connectSeconds: Number(((connectedAt - start) / 1000).toFixed(2)),
        totalSeconds: Number(((performance.now() - start) / 1000).toFixed(2)),
        latencyMs: {
            p50: latencies[Math.floor(latencies.length * .50)],
            p95: latencies[Math.floor(latencies.length * .95)],
            max: latencies.at(-1),
        },
        workersBefore: before, workersConnected: connectedWorkers, workersAfter: after,
    }, null, 2));
} finally {
    if (cables.length) progress({
        phase: 'cleanup', deliveries: seen.size, clients: cables.length,
        socketsOpen: cables.filter(cable => cable.socket.readyState === WebSocket.OPEN).length,
        backendErrors: cables.flatMap(cable => cable.events.filter(event => event.event === 'pusher:error').map(event => event.data)),
        disconnectReasons: [...new Set(cables.flatMap(cable => cable.frames.filter(frame => frame.type === 'disconnect').map(frame => frame.reason)))],
    });
    await pool(cables, cable => cable.close());
}

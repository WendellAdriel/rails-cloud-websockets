import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';

export const base = process.env.DEMO_URL || 'https://localhost:3443';
export const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
export async function until(predicate, label, timeout = 15000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        const value = await predicate();
        if (value) return value;
        await delay(25);
    }
    throw new Error(`Timed out: ${label}`);
}

await until(async () => {
    try { return (await fetch(`${base}/up`, { signal: AbortSignal.timeout(2000) })).ok; }
    catch { return false; }
}, 'proxy routing readiness', 30000);

export async function client({ anonymous = false, protocol = "actioncable-v1-json", run } = {}) {
    const cookies = new Map();
    async function request(path, payload, headers = {}) {
        const response = await fetch(`${base}${path}`, {
            method: payload === undefined ? 'GET' : 'POST',
            headers: { Origin: base, Cookie: [...cookies].map(([key, value]) => `${key}=${value}`).join('; '), 'Content-Type': 'application/json', ...(run ? { 'X-Lab-Run': run } : {}), ...headers },
            body: payload === undefined ? undefined : typeof payload === 'string' ? payload : JSON.stringify(payload),
        });
        for (const cookie of response.headers.getSetCookie()) {
            const pair = cookie.split(';')[0];
            const separator = pair.indexOf('=');
            cookies.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        return response;
    }
    let csrf;
    if (anonymous) await request("/__laravel_cloud/cable.js");
    if (!anonymous) {
        const response = await request('/');
        assert.equal(response.status, 200);
        const html = await response.text();
        csrf = html.match(/name="csrf-token" content="([^"]+)"/)?.[1];
    }
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/app/cloud-demo-key?protocol=7&client=validation&version=1`);
    const events = [];
    const frames = [];
    socket.addEventListener('message', event => {
        const frame = JSON.parse(event.data);
        if (typeof frame.data === 'string') frame.data = JSON.parse(frame.data);
        events.push(frame);
        if (frame.event === 'cloud-frame') frames.push(frame.data.frame);
        if (frame.event === 'pusher:ping') socket.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
    });
    const handshake = await until(() => events.find(frame => frame.event === 'pusher:connection_established'), 'Pusher handshake');
    let token;
    async function command(payload) {
        const response = await request('/__laravel_cloud/cable', { token, request_id: randomUUID(), ...payload });
        const body = await response.json();
        if (body.token) token = body.token;
        return { status: response.status, ...body };
    }
    const connection = await command({ command: 'connect', socket_id: handshake.data.socket_id, protocol });
    if (connection.status === 200) {
        for (const channel of connection.channels) {
            socket.send(JSON.stringify({ event: 'pusher:subscribe', data: { channel: channel.name, auth: channel.auth } }));
            await until(() => events.find(frame => frame.event === 'pusher_internal:subscription_succeeded' && frame.channel === channel.name), 'private channel authorization');
        }
        assert.equal((await command({ command: 'ready' })).status, 200);
        await until(() => frames.some(frame => frame.type === 'welcome'), 'Rails welcome');
    }
    const lease = connection.status === 200 ? setInterval(() => command({ command: "lease" }).catch(() => {}), 30000) : null;
    return {
        request, command, connection, socket, events, frames, csrf, cookies,
        get token() { return token; },
        async subscribe(channel = 'RoomChannel', parameters = { room: 'demo' }) {
            const identifier = JSON.stringify({ channel, ...parameters });
            const result = await command({ command: 'subscribe', identifier });
            assert.equal(result.status, 200, JSON.stringify(result));
            const frame = await until(() => frames.find(frame => frame.identifier === identifier && ['confirm_subscription', 'reject_subscription'].includes(frame.type)), `subscription: ${channel}`);
            return { identifier, frame };
        },
        async perform(identifier, action, payload = {}, extra = {}) {
            return command({ command: 'message', identifier, data: JSON.stringify({ action, ...payload }), ...extra });
        },
        messages(identifier) { return frames.filter(frame => frame.identifier === identifier && 'message' in frame).map(frame => frame.message); },
        async post(path, data = {}) { return request(path, data, { 'X-CSRF-Token': csrf }); },
        async close() {
            clearInterval(lease);
            const result = token ? await command({ command: 'disconnect' }).catch(() => undefined) : undefined;
            if (socket.readyState !== WebSocket.CLOSED) {
                const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
                socket.close();
                await closed;
            }
            return result;
        },
    };
}

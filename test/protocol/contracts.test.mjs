import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomUUID } from 'node:crypto';
import { base, client, delay, until } from './client.mjs';

test('automatic transport injection never exposes the application secret', async () => {
    const page = await (await fetch(base)).text();
    assert.match(page, /<head><script src="\/__laravel_cloud\/cable.js"/);
    const script = await (await fetch(`${base}/__laravel_cloud/cable.js`)).text();
    assert.match(script, /cloud-demo-key/);
    assert.doesNotMatch(script, /cloud-demo-secret/);
});

test('real connection authentication rejects anonymous users', async () => {
    const cable = await client({ anonymous: true });
    assert.equal(cable.connection.status, 401);
    await cable.close();
});

test('commands remain on their owning connection across four load-balanced workers', async () => {
    const cable = await client();
    try {
        assert.equal(cable.connection.status, 200, JSON.stringify(cable.connection));
        const { identifier } = await cable.subscribe();
        for (let count = 1; count <= 20; count++) {
            assert.equal((await cable.perform(identifier, 'speak', { text: `routing-${count}` })).status, 200);
            await until(() => cable.messages(identifier).some(message => message.text === `routing-${count}` && message.count === count), `action ${count}`);
        }
        const messages = cable.messages(identifier).filter(message => message.text?.startsWith("routing-"));
        assert.deepEqual(messages.map(message => message.count), Array.from({ length: 20 }, (_, index) => index + 1));
        assert.equal(new Set(messages.map(message => message.worker)).size, 1);
    } finally { await cable.close(); }
});

test('Rails rejects forbidden subscriptions', async () => {
    const cable = await client();
    try { assert.equal((await cable.subscribe('RoomChannel', { room: 'forbidden' })).frame.type, 'reject_subscription'); }
    finally { await cable.close(); }
});

test('a different browser session cannot reuse a connection token', async () => {
    const first = await client();
    const second = await client();
    try { assert.equal((await second.command({ command: 'lease', token: first.token })).status, 404); }
    finally { await first.close(); await second.close(); }
});

test('forged routing tokens cannot access a worker', async () => {
    const cable = await client();
    try {
        assert.equal((await cable.command({ command: 'lease', token: cable.token.slice(0, -1) + (cable.token.endsWith('0') ? '1' : '0') })).status, 404);
    } finally { await cable.close(); }
});

test('origin, media type, shape, and request size are validated', async () => {
    const cable = await client();
    try {
        const endpoint = '/__laravel_cloud/cable';
        assert.equal((await cable.request(endpoint, { command: 'connect', socket_id: '1.2' }, { Origin: 'https://foreign.example' })).status, 403);
        assert.equal((await cable.request(endpoint, '{}', { 'Content-Type': 'text/plain' })).status, 415);
        for (const body of ['null', '[]', '{', '{"command":"unknown"}', '{"command":"subscribe","identifier":null}']) assert.equal((await cable.request(endpoint, body)).status, 400);
        assert.equal((await cable.request(endpoint, 'x'.repeat(9000))).status, 413);
    } finally { await cable.close(); }
});

test('duplicate request IDs do not execute channel actions twice', async () => {
    const cable = await client();
    try {
        const { identifier } = await cable.subscribe();
        const request_id = randomUUID();
        for (let index = 0; index < 3; index++) assert.equal((await cable.perform(identifier, 'speak', { text: 'once' }, { request_id })).status, 200);
        await until(() => cable.messages(identifier).length > 0, 'first delivery');
        await delay(300);
        assert.equal(cable.messages(identifier).length, 1);
        assert.equal(cable.messages(identifier)[0].count, 1);
    } finally { await cable.close(); }
});

test('direct transmissions, custom stream callbacks, and JSON coders execute in Rails', async () => {
    const cable = await client();
    try {
        const room = await cable.subscribe();
        const custom = await cable.subscribe('CustomChannel', {});
        await cable.perform(room.identifier, 'direct', { text: 'private reply' });
        await until(() => cable.messages(room.identifier).some(message => message.kind === 'direct'), 'direct transmission');
        assert.equal((await cable.post('/broadcast', { kind: 'custom', text: 'mixed Case' })).status, 204);
        await until(() => cable.messages(custom.identifier).some(message => message.text === 'MIXED CASE'), 'custom coder');
    } finally { await cable.close(); }
});

test('stream_for and model broadcasts reach only the intended user', async () => {
    const first = await client();
    const second = await client();
    try {
        const one = await first.subscribe('ModelChannel', {});
        const two = await second.subscribe('ModelChannel', {});
        await first.post('/broadcast', { kind: 'model', text: 'user scoped' });
        await until(() => first.messages(one.identifier).length > 0, 'model stream');
        await delay(300);
        assert.equal(second.messages(two.identifier).length, 0);
    } finally { await first.close(); await second.close(); }
});

test('periodic channel transmissions stop after unsubscribe', async () => {
    const cable = await client();
    try {
        const { identifier } = await cable.subscribe('TimerChannel', {});
        await until(() => cable.messages(identifier).length > 0, 'periodic transmission');
        await cable.command({ command: 'unsubscribe', identifier });
        const count = cable.messages(identifier).length;
        await delay(2500);
        assert.equal(cable.messages(identifier).length, count);
    } finally { await cable.close(); }
});

test('remote revocation stops delivery even when the raw Pusher socket remains open', async () => {
    const attacker = await client();
    const publisher = await client();
    try {
        const { identifier } = await attacker.subscribe();
        await publisher.post('/broadcast', { text: 'before revocation' });
        await until(() => attacker.messages(identifier).length > 0, 'initial authorized delivery');
        assert.equal((await attacker.post('/revoke')).status, 204);
        await until(() => attacker.frames.some(frame => frame.type === 'disconnect' && frame.reconnect === false), 'remote disconnect');
        assert.equal(attacker.socket.readyState, WebSocket.OPEN);
        const count = attacker.messages(identifier).length;
        await publisher.post('/broadcast', { text: 'must not leak' });
        await delay(500);
        assert.equal(attacker.messages(identifier).length, count);
        assert.equal((await attacker.command({ command: 'lease' })).status, 410);
    } finally { await attacker.close(); await publisher.close(); }
});

test('AnyCable state accessors survive commands routed through different workers', async () => {
    const cable = await client();
    try {
        const { identifier } = await cable.subscribe('AnycableRoomChannel');
        for (let count = 1; count <= 3; count++) {
            await cable.perform(identifier, 'speak', { text: `state-${count}` });
            await until(() => cable.messages(identifier).some(message => message.count === count), 'AnyCable state');
        }
    } finally { await cable.close(); }
});

test('unsubscribe and disconnect run Rails cleanup callbacks', async () => {
    const cable = await client();
    const { identifier } = await cable.subscribe();
    await cable.command({ command: 'unsubscribe', identifier });
    await cable.close();
    const audit = await (await cable.request('/audit')).json();
    assert.equal(audit.events.connect, 1);
    assert.equal(audit.events.disconnect, 1);
    assert.ok(audit.events.command >= 2);
});

test('native AnyCable whisper commands require an explicitly authorized stream', async () => {
    const first = await client();
    const second = await client();
    try {
        const allowed = await first.subscribe('WhisperChannel', {});
        const listener = await second.subscribe('WhisperChannel', {});
        const forbidden = await first.subscribe();
        assert.equal((await first.command({ command: 'whisper', identifier: forbidden.identifier, data: { text: 'forbidden' } })).status, 403);
        assert.equal((await first.command({ command: 'whisper', identifier: allowed.identifier, data: { text: 'native SDK whisper' } })).status, 200);
        await until(() => second.messages(listener.identifier).some(message => message.text === 'native SDK whisper'), 'native whisper delivery');
    } finally { await first.close(); await second.close(); }
});

test('logout invalidates the Rails connection while an old backend subscription remains open', async () => {
    const subscriber = await client();
    const publisher = await client();
    try {
        const { identifier } = await subscriber.subscribe();
        assert.equal((await subscriber.post('/logout')).status, 204);
        await until(() => subscriber.frames.some(frame => frame.type === 'disconnect' && frame.reconnect === false), 'logout disconnect');
        assert.equal(subscriber.socket.readyState, WebSocket.OPEN);
        const count = subscriber.messages(identifier).length;
        await publisher.post('/broadcast', { text: 'after logout' });
        await delay(300);
        assert.equal(subscriber.messages(identifier).length, count);
        assert.equal((await subscriber.command({ command: 'lease' })).status, 410);
    } finally { await subscriber.close(); await publisher.close(); }
});

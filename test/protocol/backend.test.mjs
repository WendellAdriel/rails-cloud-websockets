import assert from 'node:assert/strict';
import { createHash, createHmac, randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { base, until } from './client.mjs';

const key = 'cloud-demo-key';
const secret = 'cloud-demo-secret';

function sign(value) {
    return createHmac('sha256', secret).update(value).digest('hex');
}

async function api(method, resource, payload, parameters = {}) {
    const path = `/apps/cloud-demo/${resource}`;
    const body = payload === undefined ? undefined : JSON.stringify(payload);
    const query = new URLSearchParams({ auth_key: key, auth_timestamp: String(Math.floor(Date.now() / 1000)), auth_version: '1.0', ...parameters });
    if (body !== undefined) query.set('body_md5', createHash('md5').update(body).digest('hex'));
    query.sort();
    const signature = sign(`${method}\n${path}\n${query}`);
    query.set('auth_signature', signature);
    const response = await fetch(`${base}${path}?${query}`, { method, body, headers: { 'Content-Type': 'application/json' } });
    assert.equal(response.status, 200, await response.clone().text());
    return response.json();
}

function publish(channel, value) {
    return api('POST', 'events', { name: 'lab-event', channels: [channel], data: JSON.stringify({ value }) });
}

async function pusher(channel, user) {
    const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/app/${key}?protocol=7&client=backend-validation&version=1`);
    const events = [];
    socket.addEventListener('message', event => {
        const frame = JSON.parse(event.data);
        if (typeof frame.data === 'string') frame.data = JSON.parse(frame.data);
        events.push(frame);
        if (frame.event === 'pusher:ping') socket.send(JSON.stringify({ event: 'pusher:pong', data: {} }));
    });
    const handshake = await until(() => events.find(frame => frame.event === 'pusher:connection_established'), 'backend handshake');
    const data = { channel };
    const channelData = user === undefined ? undefined : JSON.stringify({ user_id: user, user_info: { name: user } });
    if (channel.startsWith('private-') || channel.startsWith('presence-')) {
        data.auth = `${key}:${sign(`${handshake.data.socket_id}:${channel}${channelData === undefined ? '' : `:${channelData}`}`)}`;
    }
    if (channelData !== undefined) data.channel_data = channelData;
    socket.send(JSON.stringify({ event: 'pusher:subscribe', data }));
    const subscription = await until(() => events.find(frame => frame.event === 'pusher_internal:subscription_succeeded'), 'backend subscription');
    return {
        events, subscription,
        messages() { return events.filter(frame => frame.event === 'lab-event').map(frame => frame.data.value); },
        async close() {
            if (socket.readyState === WebSocket.CLOSED) return;
            const closed = new Promise(resolve => socket.addEventListener('close', resolve, { once: true }));
            socket.close();
            await closed;
        },
    };
}

test('ordinary Reverb channels deliver live events without replaying earlier broadcasts', async () => {
    const channel = `private-lab-live-${randomUUID()}`;
    await publish(channel, 'offline');
    const receiver = await pusher(channel);
    try {
        await publish(channel, 'live');
        await until(() => receiver.messages().includes('live'), 'live delivery');
        assert.deepEqual(receiver.messages(), ['live']);
    } finally { await receiver.close(); }
});

test('Reverb cache channels retain only the latest event for late subscribers', async () => {
    const channel = `private-cache-lab-${randomUUID()}`;
    const keeper = await pusher(channel);
    let receiver;
    try {
        await publish(channel, 'first');
        await publish(channel, 'second');
        await until(() => keeper.messages().includes('second'), 'second publication');
        receiver = await pusher(channel);
        await until(() => receiver.messages().includes('second'), 'cached latest event');
        assert.deepEqual(receiver.messages(), ['second']);
        const state = await api('GET', `channels/${channel}`, undefined, { info: 'cache' });
        assert.equal(JSON.parse(state.cache.data).value, 'second');
    } finally {
        await receiver?.close();
        await keeper.close();
    }
});

test('Reverb removes cached data when the last subscriber leaves and discards broadcasts to empty channels', async () => {
    const channel = `private-cache-lab-${randomUUID()}`;
    const keeper = await pusher(channel);
    try {
        await publish(channel, 'before-disconnect');
        await until(() => keeper.messages().length === 1, 'cached publication');
    } finally { await keeper.close(); }
    await until(async () => !(await api('GET', `channels/${channel}`)).occupied, 'empty channel');
    await publish(channel, 'while-empty');
    const receiver = await pusher(channel);
    try {
        await until(() => receiver.events.some(frame => frame.event === 'pusher:cache_miss'), 'cache miss after all subscribers leave');
        assert.deepEqual(receiver.messages(), []);
    } finally { await receiver.close(); }
});

test('Reverb presence exposes live members and removes a user after their final connection closes', async () => {
    const channel = `presence-lab-${randomUUID()}`;
    const observer = await pusher(channel, 'observer');
    const first = await pusher(channel, 'member');
    const second = await pusher(channel, 'member');
    try {
        assert.equal(second.subscription.data.presence.count, 2);
        assert.deepEqual(second.subscription.data.presence.ids.sort(), ['member', 'observer']);
        await until(() => observer.events.some(frame => frame.event === 'pusher_internal:member_added' && frame.data.user_id === 'member'), 'member joined');
        await first.close();
        const state = await api('GET', `channels/${channel}`, undefined, { info: 'user_count' });
        assert.equal(state.user_count, 2);
        await second.close();
        await until(() => observer.events.some(frame => frame.event === 'pusher_internal:member_removed' && frame.data.user_id === 'member'), 'last member connection left');
        assert.equal((await api('GET', `channels/${channel}`, undefined, { info: 'user_count' })).user_count, 1);
    } finally {
        await first.close();
        await second.close();
        await observer.close();
    }
});

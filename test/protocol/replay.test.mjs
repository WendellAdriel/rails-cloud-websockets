import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { client, until } from './client.mjs';

async function history(cable, identifier, request) {
    const count = cable.frames.length;
    assert.equal((await cable.command({ command: 'history', identifier, history: request })).status, 200);
    return until(() => cable.frames.slice(count).find(frame => ['confirm_history', 'reject_history'].includes(frame.type)), 'history acknowledgement');
}

test('retained replay applies the original coder and callback and deduplicates overlapping history', async () => {
    const sender = await client({ protocol: 'actioncable-v1-ext-json' });
    const receiver = await client({ protocol: 'actioncable-v1-ext-json' });
    try {
        const { identifier } = await sender.subscribe('CustomChannel', {});
        const positions = [];
        const texts = [];
        for (let index = 0; index < 2; index++) {
            const text = `Replay-${randomUUID()}`;
            texts.push(text.toUpperCase());
            assert.equal((await sender.post('/broadcast', { kind: 'custom', text })).status, 204);
            positions.push(await until(() => sender.frames.find(frame => frame.message?.text === text.toUpperCase()), 'custom live frame'));
        }
        await receiver.subscribe('CustomChannel', {});
        const first = positions[0];
        const request = { since: Math.floor(Date.now() / 1000) - 3600, streams: { [first.stream_id]: { epoch: first.epoch, offset: first.offset } } };
        assert.equal((await history(receiver, identifier, request)).type, 'confirm_history');
        assert.deepEqual(receiver.messages(identifier).map(message => message.text), [texts[1]]);
        assert.equal((await history(receiver, identifier, request)).type, 'confirm_history');
        assert.deepEqual(receiver.messages(identifier).map(message => message.text), [texts[1]]);
        const last = positions[1];
        assert.equal((await history(receiver, identifier, { streams: { [last.stream_id]: { epoch: last.epoch, offset: last.offset + 100 } } })).type, 'reject_history');
        assert.equal((await receiver.command({ command: 'lease' })).status, 200);
    } finally { await sender.close(); await receiver.close(); }
});

test('history requests cannot read another user model stream', async () => {
    const owner = await client({ protocol: 'actioncable-v1-ext-json' });
    const stranger = await client({ protocol: 'actioncable-v1-ext-json' });
    try {
        const { identifier } = await owner.subscribe('ModelChannel', {});
        await stranger.subscribe('ModelChannel', {});
        const text = `private-${randomUUID()}`;
        await owner.post('/broadcast', { kind: 'model', text });
        const position = await until(() => owner.frames.find(frame => frame.message?.text === text), 'private model broadcast');
        await history(stranger, identifier, { since: Math.floor(Date.now() / 1000) - 30, streams: { [position.stream_id]: { epoch: position.epoch, offset: 0 } } });
        assert.deepEqual(stranger.messages(identifier), []);
        const ownText = `own-${randomUUID()}`;
        await stranger.post('/broadcast', { kind: 'model', text: ownText });
        await until(() => stranger.messages(identifier).some(message => message.text === ownText), 'own model stream');
        assert.equal(stranger.messages(identifier).some(message => message.text === text), false);
    } finally { await owner.close(); await stranger.close(); }
});


test('live and replay preserve multiple transmissions from one custom stream callback', async () => {
    const sender = await client({ protocol: 'actioncable-v1-ext-json' });
    const receiver = await client({ protocol: 'actioncable-v1-ext-json' });
    try {
        const { identifier } = await sender.subscribe('CustomChannel', { copies: 2 });
        const text = `copies-${randomUUID()}`.toUpperCase();
        await sender.post('/broadcast', { kind: 'custom', text });
        const first = await until(() => sender.frames.find(frame => frame.message?.text === text), 'first custom output');
        await until(() => sender.messages(identifier).filter(message => message.text === text).length === 2, 'both custom outputs');
        await receiver.subscribe('CustomChannel', { copies: 2 });
        const request = { streams: { [first.stream_id]: { epoch: first.epoch, offset: first.offset - 1 } } };
        assert.equal((await history(receiver, identifier, request)).type, 'confirm_history');
        assert.deepEqual(receiver.messages(identifier).filter(message => message.text === text).map(message => message.kind), ['custom', 'custom-copy']);
        assert.equal((await history(receiver, identifier, request)).type, 'confirm_history');
        assert.equal(receiver.messages(identifier).filter(message => message.text === text).length, 2);
    } finally { await sender.close(); await receiver.close(); }
});

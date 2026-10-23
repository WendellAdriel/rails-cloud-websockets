import { createConsumer } from '@rails/actioncable';
import { createCable } from '@anycable/web';
import '@hotwired/turbo-rails';

let lab;

function setup() {
    if (!document.querySelector('#messages')) return;
    const anycable = new URL(location.href).searchParams.get('client') === 'anycable';
    const protocol = new URL(location.href).searchParams.get("protocol");
    const consumer = anycable ? createCable(protocol ? { protocol } : {}) : createConsumer();
    const state = { consumer, messages: [], extras: new Map(), readiness: new Map(), connectedCount: 0, client: anycable ? 'AnyCable' : 'Action Cable' };
    const status = document.querySelector('#status');

    function receive(message) {
        state.messages.push(message);
        if (state.messages.length > 200) state.messages.shift();
        const item = document.createElement('li');
        item.textContent = `${message.kind || 'message'}: ${message.text || JSON.stringify(message)}`;
        document.querySelector('#messages')?.prepend(item);
    }

    function subscribe(channel, parameters = {}, primary = false) {
        let resolveReady;
        const ready = new Promise(resolve => { resolveReady = resolve; });
        const connected = () => {
            resolveReady();
            if (primary) {
                state.connectedCount += 1;
                status.textContent = `${state.client} connected`;
                status.dataset.connected = 'true';
            }
        };
        const disconnected = () => {
            if (primary) {
                status.textContent = 'Disconnected';
                status.dataset.connected = 'false';
            }
        };
        if (anycable) {
            const subscription = consumer.subscribeTo(channel, parameters);
            subscription.on('connect', connected);
            subscription.on('disconnect', disconnected);
            subscription.on('message', receive);
            subscription.on('close', disconnected);
            state.readiness.set(subscription, ready);
            return subscription;
        }
        const subscription = consumer.subscriptions.create({ channel, ...parameters }, { connected, disconnected, received: receive, rejected() { status.textContent = 'Rejected'; } });
        state.readiness.set(subscription, ready);
        return subscription;
    }

    state.subscribe = () => {
        state.room = subscribe(anycable ? 'AnycableRoomChannel' : 'RoomChannel', { room: 'demo' }, true);
        return state.room;
    };
    state.extra = channel => {
        if (!state.extras.has(channel)) state.extras.set(channel, subscribe(channel));
        return state.extras.get(channel);
    };
    state.extraReady = async channel => {
        const subscription = state.extra(channel);
        await state.readiness.get(subscription);
        return subscription;
    };
    state.unsubscribe = () => {
        if (anycable) state.room.disconnect();
        else state.room.unsubscribe();
        status.dataset.connected = 'false';
        status.textContent = 'Unsubscribed';
    };
    state.perform = (action, data = {}) => state.room.perform(action, data);
    state.request = async (path, payload = {}) => {
        const response = await fetch(path, {
            method: 'POST',
            credentials: 'same-origin',
            headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': document.querySelector('meta[name="csrf-token"]').content },
            body: JSON.stringify(payload),
        });
        if (!response.ok) throw new Error(`Request failed: ${response.status}`);
        return response;
    };
    state.subscribe();
    const text = () => document.querySelector('#message').value;
    const bind = (id, action) => document.querySelector(`#${id}`).addEventListener('click', () => Promise.resolve().then(action).catch(error => receive({ kind: 'error', text: error.message })));
    bind('send', () => state.perform('speak', { text: text() }));
    bind('direct', () => state.perform('direct', { text: text() }));
    bind('broadcast', () => state.request('/broadcast', { text: text() }));
    bind('whisper', async () => {
        const subscription = await state.extraReady('WhisperChannel');
        const data = { kind: 'whisper', text: text() };
        if (anycable) return subscription.whisper(data);
        consumer.send({ command: 'whisper', identifier: subscription.identifier, data });
    });
    bind('custom', async () => { await state.extraReady('CustomChannel'); return state.request('/broadcast', { text: text(), kind: 'custom' }); });
    bind('model', async () => { await state.extraReady('ModelChannel'); return state.request('/broadcast', { text: text(), kind: 'model' }); });
    bind('timer', () => state.extra('TimerChannel'));
    bind('presence', () => state.extra('PresenceChannel'));
    bind('worker', () => {
        if (state.worker) return state.worker.postMessage({ command: 'perform', text: text() });
        state.worker = new Worker(document.querySelector('meta[name="native-worker-url"]').content, { type: 'module' });
        state.worker.addEventListener('message', event => {
            state.workerEvents ||= [];
            state.workerEvents.push(event.data);
            if (event.data.kind === 'worker_ready') state.worker.postMessage({ command: 'perform', text: text() });
            if (event.data.kind === 'worker_message') receive({ kind: 'worker', text: event.data.message.text });
        });
        state.worker.postMessage({ command: 'connect', url: `${location.protocol.replace('http', 'ws')}//${location.host}/cable` });
    });
    bind('unsubscribe', state.unsubscribe);
    bind('subscribe', state.subscribe);
    bind('reconnect', () => { consumer.disconnect(); setTimeout(() => consumer.connect(), 300); });
    bind('revoke', () => state.request('/revoke'));
    bind('logout', () => state.request('/logout'));
    bind('report', () => state.request('/reports', { text: text() }));
    document.querySelector('#details').textContent = `${state.client}. Session cookies and the standard channel APIs authenticate this connection.`;
    state.destroy = () => { consumer.disconnect(); state.worker?.terminate(); };
    lab = state;
    window.lab = state;
}

document.addEventListener('turbo:load', setup);
document.addEventListener('turbo:before-cache', () => { lab?.destroy(); lab = null; });

import { createCable } from '@anycable/core';

let consumer;
let room;
self.addEventListener('message', event => {
    if (event.data.command === 'connect') {
        consumer = createCable(event.data.url);
        room = consumer.subscribeTo('AnycableRoomChannel', { room: 'demo' });
        room.on('connect', () => {
            self.postMessage({ kind: 'worker_ready', bridgeInjected: !!self.WebSocket.__laravelCloudBridge });
        });
        room.on('message', message => self.postMessage({ kind: 'worker_message', message }));
    } else if (event.data.command === 'perform') {
        room.perform('speak', { text: event.data.text });
    } else if (event.data.command === 'disconnect') {
        consumer.disconnect();
    }
});

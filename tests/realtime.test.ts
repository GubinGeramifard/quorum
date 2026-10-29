import http from 'http';
import type { AddressInfo } from 'net';
import WebSocket from 'ws';
import request from 'supertest';
import { createDb } from '../src/db';
import { createHub, attachWebSocket } from '../src/realtime';
import { createApp } from '../src/app';

describe('real-time voting over WebSocket', () => {
  it('pushes an updated tally to subscribers when a vote is cast', async () => {
    const db = createDb(':memory:');
    const hub = createHub(db);
    const server = http.createServer(createApp(db, hub));
    attachWebSocket(server, hub);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as AddressInfo).port;
    const base = `http://localhost:${port}`;

    // Register a user and create a poll over HTTP.
    const reg = await request(base).post('/auth/register').send({ username: 'ivy', password: 'password123' });
    const tok = reg.body.token as string;
    const create = await request(base)
      .post('/polls')
      .set('authorization', `Bearer ${tok}`)
      .send({ question: 'Live?', options: ['A', 'B'] });
    const pollId = create.body.poll.id as number;
    const optionId = create.body.options[0].id as number;

    // Subscribe over WebSocket and collect messages.
    const ws = new WebSocket(`ws://localhost:${port}/ws?pollId=${pollId}`);
    const messages: Array<{ type: string; data: { total: number } }> = [];
    const gotTwo = new Promise<void>((resolve) => {
      ws.on('message', (raw: WebSocket.RawData) => {
        messages.push(JSON.parse(raw.toString()));
        if (messages.length === 2) resolve();
      });
    });
    await new Promise<void>((resolve) => ws.on('open', () => resolve()));

    // Cast a vote over HTTP; the subscriber should receive a fresh tally.
    await request(base).post(`/polls/${pollId}/vote`).set('authorization', `Bearer ${tok}`).send({ optionId });
    await gotTwo;

    expect(messages[0].data.total).toBe(0); // initial snapshot on subscribe
    expect(messages[1].data.total).toBe(1); // live update after the vote

    ws.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    db.close();
  });
});

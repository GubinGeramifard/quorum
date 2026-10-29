// Entry point: wires the database, the real-time hub, the Express app, and the
// WebSocket server onto a single HTTP server, then starts listening.
import http from 'http';
import { createDb } from './db';
import { createHub, attachWebSocket } from './realtime';
import { createApp } from './app';

const db = createDb(process.env.QUORUM_DB || 'quorum.db');
const hub = createHub(db);
const app = createApp(db, hub);

const server = http.createServer(app);
attachWebSocket(server, hub);

const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, () => {
  console.log(`quorum listening on http://localhost:${PORT} (ws at /ws)`);
});

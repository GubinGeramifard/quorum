// Real-time layer. The Hub tracks which WebSocket clients are watching which
// poll, pushes the current tally to a new subscriber immediately, and
// broadcasts fresh tallies whenever a vote or close happens. attachWebSocket
// bolts a WebSocket server onto the same HTTP server Express runs on.
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import type { DB } from './db';
import { computeTally } from './polls';

export interface Hub {
  subscribe(pollId: number, ws: WebSocket): void;
  broadcast(pollId: number): void;
}

export function createHub(db: DB): Hub {
  // pollId -> set of sockets currently watching that poll.
  const subscribers = new Map<number, Set<WebSocket>>();

  function send(ws: WebSocket, pollId: number): void {
    const tally = computeTally(db, pollId);
    if (tally && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'tally', data: tally }));
    }
  }

  return {
    subscribe(pollId, ws) {
      let set = subscribers.get(pollId);
      if (!set) {
        set = new Set();
        subscribers.set(pollId, set);
      }
      set.add(ws);
      ws.on('close', () => set!.delete(ws));
      send(ws, pollId); // so a brand-new subscriber sees results right away
    },
    broadcast(pollId) {
      const set = subscribers.get(pollId);
      if (!set) return;
      for (const ws of set) send(ws, pollId);
    },
  };
}

// Attach a WebSocket server at /ws. Clients choose a poll with a query param:
//   ws://host/ws?pollId=123
export function attachWebSocket(server: Server, hub: Hub): WebSocketServer {
  const wss = new WebSocketServer({ server, path: '/ws' });
  wss.on('connection', (ws, req) => {
    const url = new URL(req.url ?? '', 'http://localhost');
    const pollId = Number(url.searchParams.get('pollId'));
    if (!Number.isInteger(pollId) || pollId <= 0) {
      ws.close(1008, 'pollId query parameter required');
      return;
    }
    hub.subscribe(pollId, ws);
  });
  return wss;
}

# Quorum

[![ci](https://github.com/GubinGeramifard/quorum/actions/workflows/ci.yml/badge.svg)](https://github.com/GubinGeramifard/quorum/actions/workflows/ci.yml)

A real-time live-polling service built in **TypeScript on Node.js**. Create a poll, and everyone watching it sees the vote tally update instantly over WebSockets, no refresh.

It is a small but complete backend: a REST API (Express), real-time push (`ws`), a SQLite database, JWT authentication, input validation, rate limiting, and a test suite that covers both the HTTP API and the live WebSocket flow.

## Features

- **REST API** for registering, logging in, and creating/closing polls.
- **Real-time results** over WebSockets: subscribe to a poll and receive the current tally immediately, then a fresh tally every time anyone votes.
- **JWT auth** with bcrypt-hashed passwords.
- **One vote per user**, enforced by a database `UNIQUE` constraint so even concurrent requests cannot double-count.
- **Validation** (Zod) and **rate limiting** on every endpoint.
- **Tests** (Jest + Supertest) for the API and a real WebSocket round-trip.

## Stack

TypeScript · Express · `ws` (WebSockets) · better-sqlite3 · jsonwebtoken · bcryptjs · Zod · express-rate-limit · Jest

## Run

```sh
npm install
npm run dev          # start on http://localhost:3000 (WebSocket at /ws)
npm test             # run the test suite
npm run build        # compile TypeScript to dist/
```

## API

| Method | Route | Auth | Body | Description |
|---|---|---|---|---|
| POST | `/auth/register` | - | `{ username, password }` | Create an account, returns a JWT |
| POST | `/auth/login` | - | `{ username, password }` | Log in, returns a JWT |
| POST | `/polls` | Bearer | `{ question, options[] }` | Create a poll (2-10 options) |
| GET | `/polls` | - | - | List polls |
| GET | `/polls/:id` | - | - | Poll details with live tally |
| POST | `/polls/:id/vote` | Bearer | `{ optionId }` | Cast a vote (once per user) |
| POST | `/polls/:id/close` | Bearer | - | Close a poll (creator only) |

**WebSocket:** connect to `ws://host/ws?pollId=<id>`. On connect you receive the current tally; after that, a `{ type: "tally", data: {...} }` message is pushed whenever the poll changes.

## Design notes

- **One HTTP server, two protocols.** Express handles REST; a `ws` WebSocket server is attached to the same HTTP server, so both share a port.
- **A pub/sub hub** maps each poll id to the set of sockets watching it. A vote (over REST) triggers a broadcast to exactly those subscribers, not everyone.
- **Dependency injection.** The app receives its database, so tests run against a fresh in-memory SQLite instance with zero shared state.
- **Correctness at the database layer.** Rather than trusting application code to prevent double-voting, the `votes` table has a `UNIQUE (poll_id, user_id)` constraint, so the guarantee holds even under a race.

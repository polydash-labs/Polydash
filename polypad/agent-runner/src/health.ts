/**
 * Health: a tiny HTTP server plus a heartbeat file written every loop.
 *
 * GET /health -> {"status":"ok"} (liveness probe)
 * GET /status -> last loop summary: when it ran, what it decided, errors.
 * heartbeat.json in DATA_DIR mirrors the same summary for operators that
 * watch the filesystem instead of HTTP.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export interface HealthStatus {
  status: 'ok' | 'error';
  startedAt: string;
  lastLoopAt: string | null;
  loops: number;
  errors: number;
  lastDecision: string | null;
  lastAction: string | null;
  lastTxHash: string | null;
  agentId: string | null;
  executor: string;
  vault: string;
}

export function emptyHealthStatus(executor: string, vault: string, agentId: string | null): HealthStatus {
  return {
    status: 'ok',
    startedAt: new Date().toISOString(),
    lastLoopAt: null,
    loops: 0,
    errors: 0,
    lastDecision: null,
    lastAction: null,
    lastTxHash: null,
    agentId,
    executor,
    vault,
  };
}

export function heartbeatPath(dataDir: string): string {
  return join(dataDir, 'heartbeat.json');
}

export function writeHeartbeat(dataDir: string, status: HealthStatus): void {
  const path = heartbeatPath(dataDir);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
}

export function startHealthServer(port: number, getStatus: () => HealthStatus): Server {
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ status: 'ok' }));
      return;
    }
    if (req.url === '/status') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(getStatus()));
      return;
    }
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'not found' }));
  });
  server.listen(port);
  return server;
}

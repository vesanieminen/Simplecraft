/**
 * Little Block World server.
 * Serves the app (Vite middleware in dev, built assets in prod) and the
 * world persistence API. Same port for everything — LAN-friendly.
 */

import express, { type Request, type Response } from 'express';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA_DIR = process.env.LBW_DATA_DIR ?? path.join(ROOT, 'world-data');
const WORLD_FILE = path.join(DATA_DIR, 'world.json');
const WORLD_BAK = path.join(DATA_DIR, 'world.bak.json');
const PORT = Number(process.env.PORT ?? 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface WorldSave {
  version: number;
  seed: number;
  mods: Record<string, number>;
  collectedStars: number[];
}

function validSave(x: unknown): x is WorldSave {
  if (!x || typeof x !== 'object') return false;
  const s = x as WorldSave;
  if (s.version !== 1) return false;
  if (typeof s.seed !== 'number' || !Number.isInteger(s.seed)) return false;
  if (!s.mods || typeof s.mods !== 'object') return false;
  for (const [k, v] of Object.entries(s.mods)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i > 2_500_000) return false;
    if (typeof v !== 'number' || v < 0 || v > 255) return false;
  }
  if (!Array.isArray(s.collectedStars)) return false;
  if (s.collectedStars.some((n) => !Number.isInteger(n) || n < 0)) return false;
  return true;
}

function readWorld(): WorldSave | null {
  for (const f of [WORLD_FILE, WORLD_BAK]) {
    try {
      const raw = fs.readFileSync(f, 'utf8');
      const parsed = JSON.parse(raw);
      if (validSave(parsed)) return parsed;
    } catch {
      // corrupt or missing — try the backup
    }
  }
  return null;
}

function writeWorld(save: WorldSave): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  try {
    if (fs.existsSync(WORLD_FILE)) fs.copyFileSync(WORLD_FILE, WORLD_BAK);
  } catch { /* best effort */ }
  const tmp = WORLD_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(save));
  fs.renameSync(tmp, WORLD_FILE); // atomic on POSIX
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'little-block-world' });
  });

  app.get('/api/world', (_req: Request, res: Response) => {
    res.json(readWorld());
  });

  app.post('/api/world', (req, res) => {
    if (!validSave(req.body)) {
      res.status(400).json({ error: 'bad save' });
      return;
    }
    try {
      // merge: per-key last write wins, never lose another client's blocks
      const prev = readWorld();
      const incoming = req.body;
      if (!prev || prev.seed !== incoming.seed) {
        writeWorld(incoming);
      } else {
        const mods = { ...prev.mods, ...incoming.mods };
        const collectedStars = [...new Set([...prev.collectedStars, ...incoming.collectedStars])].sort((a, b) => a - b);
        writeWorld({ version: 1, seed: incoming.seed, mods, collectedStars });
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'write failed' });
    }
  });

  app.post('/api/world/reset', (_req, res) => {
    try {
      for (const f of [WORLD_FILE, WORLD_BAK, WORLD_FILE + '.tmp']) {
        if (fs.existsSync(f)) fs.unlinkSync(f);
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'reset failed' });
    }
  });

  if (IS_PROD) {
    const dist = path.join(ROOT, 'dist');
    app.use(express.static(dist));
    app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  } else {
    const { createServer } = await import('vite');
    const vite = await createServer({
      configFile: path.join(ROOT, 'vite.config.ts'),
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  const server = http.createServer(app);
  server.listen(PORT, '0.0.0.0', () => {
    const nets = os.networkInterfaces();
    const ips: string[] = [];
    for (const list of Object.values(nets)) {
      for (const n of list ?? []) {
        if (n.family === 'IPv4' && !n.internal) ips.push(n.address);
      }
    }
    console.log('');
    console.log('  🧱 Little Block World is running!');
    console.log('  ──────────────────────────────────');
    console.log(`  This computer:   http://localhost:${PORT}`);
    for (const ip of ips) {
      console.log(`  Other computers: http://${ip}:${PORT}`);
    }
    console.log('');
    console.log('  Controllers: plug in gamepads and press any button to join.');
    console.log('  Two controllers = automatic split screen. Up to 4 players!');
    console.log('');
  });
}

void main();

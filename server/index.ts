/**
 * Elocraft server.
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
const PORT = Number(process.env.PORT ?? 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface WorldSave {
  version: number;
  seed: number;
  theme?: number;
  mods: Record<string, number>;
  collectedStars: number[];
  doorFacing?: Record<string, number>;
  stairFacing?: Record<string, number>;
  waterLevels?: Record<string, number>;
  ladderFacing?: Record<string, number>;
  savedAt?: number;
}

/** what GET /api/world/list hands back, one entry per saved world */
interface SavedWorldInfo {
  seed: number;
  theme: number;
  savedAt: number;
  mods: number;
}

function validSave(x: unknown): x is WorldSave {
  if (!x || typeof x !== 'object') return false;
  const s = x as WorldSave;
  if (s.version !== 1 && s.version !== 2 && s.version !== 3 && s.version !== 4 && s.version !== 5) return false;
  if (typeof s.seed !== 'number' || !Number.isInteger(s.seed)) return false;
  if (s.theme !== undefined && (typeof s.theme !== 'number' || !Number.isInteger(s.theme) || s.theme < 0 || s.theme > 64)) return false;
  if (!s.mods || typeof s.mods !== 'object') return false;
  for (const [k, v] of Object.entries(s.mods)) {
    const i = Number(k);
    if (!Number.isInteger(i) || i < 0 || i > 4_200_000) return false;
    if (typeof v !== 'number' || v < 0 || v > 255) return false;
  }
  if (!Array.isArray(s.collectedStars)) return false;
  if (s.collectedStars.some((n) => !Number.isInteger(n) || n < 0)) return false;
  if (s.doorFacing !== undefined) {
    for (const [k, v] of Object.entries(s.doorFacing)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i > 4_200_000) return false;
      if (v !== 0 && v !== 1) return false;
    }
  }
  if (s.stairFacing !== undefined) {
    for (const [k, v] of Object.entries(s.stairFacing)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i > 4_200_000) return false;
      if (v !== 0 && v !== 1 && v !== 2 && v !== 3) return false;
    }
  }
  if (s.ladderFacing !== undefined) {
    for (const [k, v] of Object.entries(s.ladderFacing)) {
      const i = Number(k);
      if (!Number.isInteger(i) || i < 0 || i > 4_200_000) return false;
      if (v !== 0 && v !== 1 && v !== 2 && v !== 3) return false;
    }
  }
  if (s.savedAt !== undefined && typeof s.savedAt !== 'number') return false;
  return true;
}

function worldFile(seed: number, theme: number): string {
  return path.join(DATA_DIR, `world-${seed}-${theme}.json`);
}

/** each saved world lives in its own file, keyed by seed + theme */
function listWorldFiles(): string[] {
  try {
    // includes .bak.json siblings: anything that deletes worlds must delete those too
    return fs.readdirSync(DATA_DIR).filter((f) => /^world-.+\.json$/.test(f)).map((f) => path.join(DATA_DIR, f));
  } catch {
    return [];
  }
}

/** one row per real (non-backup) saved world, newest saved first */
function listWorldInfos(): SavedWorldInfo[] {
  const out: SavedWorldInfo[] = [];
  for (const f of listWorldFiles()) {
    if (f.endsWith('.bak.json')) continue;
    try {
      const s = JSON.parse(fs.readFileSync(f, 'utf8')) as WorldSave;
      if (!Number.isInteger(s.seed)) continue;
      out.push({
        seed: s.seed,
        theme: s.theme ?? 0,
        savedAt: s.savedAt ?? fs.statSync(f).mtimeMs,
        mods: Object.keys(s.mods ?? {}).length,
      });
    } catch { /* corrupt file: it will fall back to its backup when played */ }
  }
  out.sort((a, b) => b.savedAt - a.savedAt);
  return out;
}

function readWorld(seed: number, theme: number): WorldSave | null {
  const primary = worldFile(seed, theme);
  for (const f of [primary, primary.replace('.json', '.bak.json')]) {
    try {
      const parsed = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (validSave(parsed)) return parsed;
    } catch {
      // corrupt or missing — try the backup
    }
  }
  return null;
}

function writeWorld(save: WorldSave): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = worldFile(save.seed, save.theme ?? 0);
  const bak = file.replace('.json', '.bak.json');
  try {
    if (fs.existsSync(file)) fs.copyFileSync(file, bak);
  } catch { /* best effort */ }
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(save));
  fs.renameSync(tmp, file); // atomic on POSIX
}

async function main(): Promise<void> {
  const app = express();
  app.use(express.json({ limit: '20mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, name: 'little-block-world' });
  });

  // GET /api/world?seed=..&theme=.. — returns that world's saved edits (or null)
  app.get('/api/world', (req: Request, res: Response) => {
    const seed = Number(req.query.seed);
    const theme = Number(req.query.theme) || 0;
    if (!Number.isInteger(seed)) {
      res.status(400).json({ error: 'seed required' });
      return;
    }
    res.json(readWorld(seed, theme));
  });

  // GET /api/world/list — every saved world (seed, theme, last saved, edits)
  app.get('/api/world/list', (_req, res) => {
    res.json(listWorldInfos());
  });

  app.post('/api/world', (req, res) => {
    if (!validSave(req.body)) {
      res.status(400).json({ error: 'bad save' });
      return;
    }
    try {
      // merge: per-key last write wins, never lose another client's blocks
      const theme = req.body.theme ?? 0;
      const prev = readWorld(req.body.seed, theme);
      const incoming = req.body;
      if (!prev || prev.seed !== incoming.seed) {
        writeWorld({ ...incoming, theme, savedAt: incoming.savedAt ?? Date.now() });
      } else {
        const mods = { ...prev.mods, ...incoming.mods };
        const collectedStars = [...new Set([...prev.collectedStars, ...incoming.collectedStars])].sort((a, b) => a - b);
        const doorFacing = { ...prev.doorFacing, ...incoming.doorFacing };
        const stairFacing = { ...prev.stairFacing, ...incoming.stairFacing };
        const waterLevels = { ...prev.waterLevels, ...incoming.waterLevels };
        const ladderFacing = { ...prev.ladderFacing, ...incoming.ladderFacing };
        writeWorld({
          version: 5, seed: incoming.seed, theme, mods, collectedStars, doorFacing, stairFacing, waterLevels, ladderFacing,
          savedAt: Math.max(prev.savedAt ?? 0, incoming.savedAt ?? 0) || Date.now(),
        });
      }
      res.json({ ok: true });
    } catch {
      res.status(500).json({ error: 'write failed' });
    }
  });

  // POST /api/world/reset?seed=..&theme=.. — reset one world; no args = all worlds
  app.post('/api/world/reset', (req, res) => {
    try {
      const seedParam = req.query.seed;
      if (seedParam !== undefined && seedParam !== '') {
        const seed = Number(seedParam);
        const theme = Number(req.query.theme) || 0;
        for (const f of [worldFile(seed, theme), worldFile(seed, theme).replace('.json', '.bak.json')]) {
          if (fs.existsSync(f)) fs.unlinkSync(f);
        }
      } else {
        for (const f of listWorldFiles()) fs.unlinkSync(f);
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
    console.log('  🧱 Elocraft is running!');
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

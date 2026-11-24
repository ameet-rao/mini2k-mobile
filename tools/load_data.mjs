// Node-only loader for data/*.json (the engine itself never does I/O).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildIndex } from '../src/engine/data.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function loadData() {
  const players = JSON.parse(readFileSync(join(ROOT, 'data/players.json'), 'utf8'));
  const teams = JSON.parse(readFileSync(join(ROOT, 'data/teams.json'), 'utf8'));
  return buildIndex(players, teams);
}

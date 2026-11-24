#!/usr/bin/env node
// Golden-master guard: gameplay must not change while the presentation layer is rebuilt.
// Hashes the full event log + box score of fixed-seed games:
//   - headless engine sims: 5 seeds x 4 matchups
//   - real-time layer (CPU vs CPU, 60 Hz, no rendering): 2 seeds x 4 matchups, 3-minute quarters
//   node tools/golden.mjs            compare against tools/golden.json (exit 1 on any difference)
//   node tools/golden.mjs --record   write a new baseline (only when gameplay is changed on purpose)
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadData, ROOT } from './load_data.mjs';
import { Game } from '../src/engine/game.js';
import { LiveGame } from '../src/engine/live.js';
import { deriveBoxScore } from '../src/engine/boxscore.js';

const FILE = join(ROOT, 'tools/golden.json');
const data = loadData();
const MATCHUPS = [['PHI', 'BOS'], ['LAL', 'GSW'], ['BOS', 'LAL'], ['GSW', 'PHI'], ['OKC', 'SAS'], ['NYK', 'DEN'], ['MIA', 'CLE'], ['HOU', 'TOR'], ['CHI', 'WAS']];
const hash = (events) => createHash('sha256').update(JSON.stringify(events)).update(JSON.stringify(deriveBoxScore(events))).digest('hex').slice(0, 16);

const out = {};
for (const [home, away] of MATCHUPS) {
  for (let seed = 1; seed <= 5; seed++) {
    const g = new Game(data, { home, away, seed: seed * 1000 + 7 }).simToEnd();
    out[`sim ${away}@${home} #${seed}`] = `${hash(g.events)} ${g.state.score.away}-${g.state.score.home}`;
  }
  for (let seed = 1; seed <= 2; seed++) {
    const L = new LiveGame(data, { home, away, seed: seed * 77 + 3, user: null, rules: { quarterMinutes: 3 } });
    let n = 0;
    while (L.phase !== 'final' && n++ < 2e6) L.update(1 / 60);
    out[`live ${away}@${home} #${seed}`] = `${hash(L.game.events)} ${L.state.score.away}-${L.state.score.home}`;
  }
}

if (process.argv.includes('--record') || !existsSync(FILE)) {
  writeFileSync(FILE, JSON.stringify(out, null, 1) + '\n');
  console.log(`golden: baseline recorded (${Object.keys(out).length} games) -> tools/golden.json`);
} else {
  const base = JSON.parse(readFileSync(FILE, 'utf8'));
  const diff = Object.keys({ ...base, ...out }).filter((k) => base[k] !== out[k]);
  if (diff.length) {
    console.log(`golden: FAIL, gameplay changed in ${diff.length} game(s):`);
    for (const k of diff) console.log(`  ${k}: baseline ${base[k]}  now ${out[k]}`);
    process.exit(1);
  }
  console.log(`golden: PASS, ${Object.keys(out).length} games identical to baseline.`);
}

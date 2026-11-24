// Public engine API (pure, headless; safe to import from Node or the browser).
export { Rng, mulberry32 } from './rng.js';
export { buildIndex, posGroup } from './data.js';
export * as rules from './rules.js';
export { MODEL } from './model.js';
export { Game, createGame } from './game.js';
export { deriveBoxScore, fmtMinutes, pct } from './boxscore.js';
export { describe, fmtClock, periodName } from './pbp.js';

/** Convenience: simulate a whole game and return { game, box }. */
import { Game } from './game.js';
import { deriveBoxScore } from './boxscore.js';
export function simulateGame(data, opts) {
  const game = new Game(data, opts).simToEnd();
  return { game, box: deriveBoxScore(game.events) };
}

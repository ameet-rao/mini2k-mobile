// NBA rules as pure functions + config. No randomness, no state mutation.

export const DEFAULT_RULES = {
  quarterMinutes: 12,     // menu: 2 / 5 / 6 / 8 / 12
  otMinutes: 5,
  periods: 4,
  shotClock: 24,
  shotClockReset: 14,     // offensive rebound / kicked ball / frontcourt foul restart
  backcourtSecs: 8,
  inboundSecs: 5,
  threeInKey: false,      // optional; the possession model folds it into turnovers when on
  foulOutLimit: 6,
  bonusAt: 5,             // team fouls per quarter -> penalty (2 FT) on the 5th
  bonusAtOT: 4,
  twoMinuteRule: true,    // 2nd team foul in the last 2:00 of a period -> penalty
  timeouts: 7,            // menu
  difficulty: 'pro',      // used by the real-time layer later
};

export const SHOT_POINTS = { rim: 2, mid: 2, three: 3 };

/**
 * StreetBall 3on3 (its own mode only): half court, 3 on 3, first to 21 by 1s and 2s, win by two,
 * no fouls, no free throws, no timeouts, no subs, no game clock (a 12-second shot clock).
 * The long period just keeps the game clock out of the way; the game ends on the score.
 */
export const STREET_RULES = {
  street: true, target: 21, winBy: 2,
  periods: 1, quarterMinutes: 600, otMinutes: 600,
  shotClock: 12, shotClockReset: 12, timeouts: 0,
};
export const STREET_POINTS = { rim: 1, mid: 1, three: 2 };

/** StreetBall: has a team reached the target with a big enough lead? */
export function streetWinner(score, rules) {
  for (const [a, b] of [['home', 'away'], ['away', 'home']]) {
    if (score[a] >= rules.target && score[a] - score[b] >= rules.winBy) return a;
  }
  return null;
}

export function makeRules(overrides = {}) {
  return { ...DEFAULT_RULES, ...overrides };
}

/** Length of a period in seconds (OT periods are 5:00, or one quarter long when quarters are shorter). */
export function periodLength(period, rules) {
  return (period <= rules.periods ? rules.quarterMinutes : Math.min(rules.otMinutes, rules.quarterMinutes)) * 60;
}

export function isOvertime(period, rules) {
  return period > rules.periods;
}

/** Game-clock seconds scaled to the chosen quarter length (e.g. "8:00 of Q4" in a 12-min game). */
export function scaledClock(secondsIn12MinQuarter, rules) {
  return secondsIn12MinQuarter * (rules.quarterMinutes / 12);
}

/**
 * Shot clock after a restart.
 *  made FG / defensive rebound / turnover / backcourt foul -> full 24
 *  offensive rebound -> 14
 *  kicked ball / frontcourt foul restart (non-penalty) -> max(remaining, 14)
 */
export function shotClockAfter(reason, remaining, rules) {
  switch (reason) {
    case 'made':
    case 'defreb':
    case 'turnover':
    case 'jump':
    case 'period':
    case 'ft_made':
      return rules.shotClock;
    case 'oreb':
      return rules.shotClockReset;
    case 'kicked':
    case 'foul_frontcourt':
      return Math.max(remaining, rules.shotClockReset);
    default:
      return rules.shotClock;
  }
}

/** Shot clock is turned off when the game clock is shorter than it. */
export function shotClockActive(gameClock, shotClock) {
  return shotClock < gameClock;
}

/**
 * Is a defensive foul a penalty (bonus) foul? Called AFTER the team-foul counters
 * have been incremented for the foul being committed.
 * @param teamFouls      team fouls this period including this one
 * @param foulsLast2     team fouls in the final 2:00 of this period including this one
 */
export function isPenaltyFoul(teamFouls, foulsLast2, clock, period, rules) {
  const limit = isOvertime(period, rules) ? rules.bonusAtOT : rules.bonusAt;
  if (teamFouls >= limit) return true;
  if (rules.twoMinuteRule && clock <= 120 && foulsLast2 >= 2) return true;
  return false;
}

/** Free throws awarded for a shooting foul. */
export function shootingFoulFTs(shotType, made) {
  if (made) return 1; // and-1
  return shotType === 'three' ? 3 : 2;
}

export function isFouledOut(fouls, rules) {
  return fouls >= rules.foulOutLimit;
}

/**
 * Foul trouble (coach's rule of thumb): 2 in Q1, 3 in the first half, 4 in Q3 or
 * before 8:00 of Q4 (scaled to quarter length). Late Q4 / OT: play through it.
 */
export function inFoulTrouble(fouls, period, clock, rules) {
  if (period === 1) return fouls >= 2;
  if (period === 2) return fouls >= 3;
  if (period === 3) return fouls >= 4;
  if (period === 4) return clock > scaledClock(8 * 60, rules) && fouls >= 4;
  return false;
}

/** Substitutions only on a dead ball with the clock stopped. After a made FG the clock
 *  only stops in the last 2:00 of Q4/OT. */
export function canSubstitute(deadBallReason, period, clock, rules) {
  if (deadBallReason === 'made') return period >= rules.periods && clock <= 120;
  return ['foul', 'timeout', 'violation', 'out_of_bounds', 'period', 'ft', 'jump', 'injury'].includes(deadBallReason);
}

/** End of regulation/OT: tie -> another 5:00 OT. */
export function gameIsOver(period, scoreA, scoreB, rules) {
  return period >= rules.periods && scoreA !== scoreB;
}

/** Possession for periods 2-4 from the opening tip (NBA alternating rule). */
export function periodStartPossession(period, tipWinner, rules) {
  if (period > rules.periods) return null; // OT: new jump ball
  const loser = tipWinner === 'home' ? 'away' : 'home';
  if (period === 1) return tipWinner;
  if (period === 4) return tipWinner;
  return loser; // Q2, Q3
}

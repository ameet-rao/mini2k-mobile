// Box score derived ONLY from the event log. Nothing here reads game state.

const STAT_KEYS = ['sec', 'pts', 'fgm', 'fga', 'tpm', 'tpa', 'ftm', 'fta', 'oreb', 'dreb', 'reb', 'ast', 'stl', 'blk', 'tov', 'pf', 'pm'];

function blankLine() {
  return Object.fromEntries(STAT_KEYS.map((k) => [k, 0]));
}

/**
 * @param events game.events
 * @returns {{ home:TeamBox, away:TeamBox, periods:number, final:{home,away} }}
 *   TeamBox = { players:{id:line}, order:[ids], totals:line, teamReb:{off,def}, byPeriod:[pts...],
 *               possessions, shotClockViolations, timeouts }
 */
export function deriveBoxScore(events) {
  const box = { home: newTeam(), away: newTeam(), periods: 0, final: { home: 0, away: 0 } };
  const onCourt = { home: new Set(), away: new Set() };
  const line = (side, id) => {
    const t = box[side];
    if (!t.players[id]) { t.players[id] = blankLine(); t.order.push(id); }
    return t.players[id];
  };
  const other = (s) => (s === 'home' ? 'away' : 'home');
  let lastClock = 0, lastPeriod = 0;

  const advance = (ev) => {
    if (ev.period === lastPeriod) {
      const dt = Math.max(0, lastClock - ev.clock);
      if (dt > 0) for (const side of ['home', 'away']) for (const id of onCourt[side]) line(side, id).sec += dt;
    }
    lastClock = ev.clock;
    lastPeriod = ev.period;
  };
  const score = (side, pts) => {
    box[side].byPeriod[box.periods - 1] = (box[side].byPeriod[box.periods - 1] ?? 0) + pts;
    for (const id of onCourt[side]) line(side, id).pm += pts;
    for (const id of onCourt[other(side)]) line(other(side), id).pm -= pts;
  };

  for (const ev of events) {
    advance(ev);
    switch (ev.type) {
      case 'period_start':
        box.periods = ev.period;
        for (const side of ['home', 'away']) {
          onCourt[side] = new Set(ev.lineups[side]);
          for (const id of ev.lineups[side]) line(side, id);
          box[side].byPeriod[ev.period - 1] = box[side].byPeriod[ev.period - 1] ?? 0;
        }
        lastClock = ev.clock;
        if (ev.period === 1) for (const side of ['home', 'away']) box[side].starters = [...ev.lineups[side]];
        break;
      case 'sub':
        onCourt[ev.team].delete(ev.out);
        onCourt[ev.team].add(ev.in);
        line(ev.team, ev.in);
        break;
      case 'shot': {
        const l = line(ev.team, ev.player);
        l.fga += 1;
        if (ev.shot === 'three') l.tpa += 1;
        if (ev.made) {
          l.fgm += 1;
          if (ev.shot === 'three') l.tpm += 1;
          l.pts += ev.pts;
          if (ev.assist) line(ev.team, ev.assist).ast += 1;
          score(ev.team, ev.pts);
        }
        if (ev.block) line(other(ev.team), ev.block).blk += 1;
        break;
      }
      case 'ft': {
        const l = line(ev.team, ev.player);
        l.fta += 1;
        if (ev.made) { l.ftm += 1; l.pts += 1; score(ev.team, 1); }
        break;
      }
      case 'rebound':
        if (ev.player) {
          const l = line(ev.team, ev.player);
          if (ev.off) l.oreb += 1; else l.dreb += 1;
          l.reb += 1;
        } else if (ev.off) box[ev.team].teamReb.off += 1;
        else box[ev.team].teamReb.def += 1;
        break;
      case 'turnover':
        if (ev.player) line(ev.team, ev.player).tov += 1;
        else box[ev.team].teamTov += 1;
        if (ev.steal) line(other(ev.team), ev.steal).stl += 1;
        if (ev.kind === 'shot_clock') box[ev.team].shotClockViolations += 1;
        break;
      case 'foul':
        line(ev.team, ev.player).pf += 1;
        if (ev.kind !== 'offensive') box[ev.team].teamFouls += 1;
        break;
      case 'foul_out':
        box[ev.team].fouledOut.push(ev.player);
        break;
      case 'timeout':
        box[ev.team].timeouts += 1;
        break;
      case 'game_end':
        box.final = { home: ev.home, away: ev.away };
        box.winner = ev.winner;
        break;
    }
  }

  for (const side of ['home', 'away']) {
    const t = box[side];
    const tot = blankLine();
    for (const id of t.order) for (const k of STAT_KEYS) tot[k] += t.players[id][k];
    tot.tov += t.teamTov;
    tot.pm = 0;
    t.totals = tot;
    // Standard possession estimate.
    t.possessions = tot.fga - tot.oreb - t.teamReb.off + tot.tov + 0.44 * tot.fta;
  }
  if (!box.final.home && !box.final.away) {
    box.final = { home: box.home.totals.pts, away: box.away.totals.pts };
  }
  return box;
}

function newTeam() {
  return {
    players: {}, order: [], starters: [], totals: null, teamReb: { off: 0, def: 0 }, teamTov: 0,
    teamFouls: 0, byPeriod: [], fouledOut: [], shotClockViolations: 0, timeouts: 0, possessions: 0,
  };
}

export function fmtMinutes(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec - m * 60);
  return `${m}:${String(s === 60 ? 59 : s).padStart(2, '0')}`;
}

export const pct = (m, a) => (a ? m / a : 0);

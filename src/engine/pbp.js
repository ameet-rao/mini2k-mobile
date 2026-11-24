// Play-by-play text from events (pure).

export function fmtClock(sec) {
  if (sec < 60) return `${sec.toFixed(1)}`;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec - m * 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function periodName(period, periods = 4) {
  return period <= periods ? `Q${period}` : `OT${period - periods === 1 ? '' : period - periods}`;
}

const SHOT_NAME = { rim: 'layup', mid: 'jumper', three: '3-pointer' };
const TOV_NAME = {
  bad_pass: 'bad pass', lost_ball: 'lost ball', bad_pass_out_of_bounds: 'bad pass (out of bounds)',
  traveling: 'traveling', out_of_bounds: 'stepped out of bounds', offensive_foul: 'offensive foul',
  not_cleared: "didn't clear the ball", shot_clock: 'shot clock violation', eight_second: '8-second violation',
  five_second_inbound: '5-second inbound violation', backcourt: 'backcourt violation', three_seconds: '3 seconds in the key',
};

/**
 * @param ev     event
 * @param byId   player lookup (data.byId)
 * @param teams  { home:'PHI', away:'BOS' } team ids for labels
 */
export function describe(ev, byId, teams = { home: 'HOME', away: 'AWAY' }) {
  const n = (id) => (id ? byId[id]?.name ?? id : 'Team');
  const T = (side) => teams[side] ?? side;
  switch (ev.type) {
    case 'game_start': return `${ev.away} at ${ev.home}`;
    case 'period_start': return `Start of ${periodName(ev.period)}`;
    case 'period_end': return `End of ${periodName(ev.period)}`;
    case 'coin_flip': return `${T(ev.team)} wins the coin flip and takes the ball first`;
    case 'jump_ball': return `Jump ball: ${n(ev.home)} vs ${n(ev.away)}, ${T(ev.team)} gains possession`;
    case 'shot': {
      let kind = SHOT_NAME[ev.shot];
      if (ev.shot === 'rim' && ev.fastBreak) kind = 'fast-break layup';
      if (ev.putback) kind = 'putback';
      if (ev.heave) kind = 'heave';
      if (ev.made) {
        return `${n(ev.player)} makes ${kind}${ev.assist ? ` (${n(ev.assist)} assists)` : ''}${ev.and1 ? ', and one!' : ''}`;
      }
      return `${n(ev.player)} misses ${kind}${ev.block ? ` (blocked by ${n(ev.block)})` : ''}`;
    }
    case 'ft': return `${n(ev.player)} ${ev.made ? 'makes' : 'misses'} free throw ${ev.n} of ${ev.of}`;
    case 'rebound': return ev.player ? `${n(ev.player)} ${ev.off ? 'offensive' : 'defensive'} rebound` : `${T(ev.team)} team rebound`;
    case 'turnover': return `${ev.player ? n(ev.player) : T(ev.team)} turnover: ${TOV_NAME[ev.kind] ?? ev.kind}${ev.steal ? ` (stolen by ${n(ev.steal)})` : ''}`;
    case 'foul': {
      const kind = { shooting: 'shooting foul', personal: 'personal foul', offensive: 'offensive foul', loose_ball: 'loose ball foul' }[ev.kind];
      return `${n(ev.player)} ${kind} (P${ev.personal}${ev.kind !== 'offensive' ? `, T${ev.teamFouls}` : ''})${ev.penalty ? ' - penalty' : ''}`;
    }
    case 'foul_out': return `${n(ev.player)} has fouled out`;
    case 'sub': return `${T(ev.team)} sub: ${n(ev.in)} in for ${n(ev.out)}`;
    case 'timeout': return `${T(ev.team)} timeout (${ev.left} left)`;
    case 'game_end': return `Final: ${T('away')} ${ev.away}, ${T('home')} ${ev.home}`;
    default: return ev.type;
  }
}

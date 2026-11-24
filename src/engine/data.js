// Pure data helpers: index players/teams loaded from data/*.json.
// The caller does the I/O (fetch in the browser, fs in Node) and passes parsed JSON in.

export const POS_GROUP = { PG: 'G', SG: 'G', SF: 'W', PF: 'B', C: 'B' };
export const POS_ORDER = { PG: 0, SG: 1, SF: 2, PF: 3, C: 4 };

/**
 * @param {object} playersJson parsed data/players.json ({meta, players:[...]})
 * @param {object} teamsJson   parsed data/teams.json   ({meta, teams:{...}})
 */
export function buildIndex(playersJson, teamsJson) {
  const players = playersJson.players ?? playersJson;
  const teams = teamsJson.teams ?? teamsJson;
  const byId = Object.create(null);
  for (const p of players) byId[p.id] = p;

  // League baselines: minutes-weighted means of every attribute (available players only).
  // The sim model is written relative to these so it stays calibrated if ratings are rebuilt.
  const pool = players.filter((p) => p.available);
  const wsum = pool.reduce((s, p) => s + p.tendencies.mpg_role, 0);
  const league = { attrs: {}, tend: {} };
  for (const key of Object.keys(pool[0].attrs)) {
    league.attrs[key] = pool.reduce((s, p) => s + p.attrs[key] * p.tendencies.mpg_role, 0) / wsum;
  }
  for (const key of Object.keys(pool[0].tendencies)) {
    league.tend[key] = pool.reduce((s, p) => s + p.tendencies[key] * p.tendencies.mpg_role, 0) / wsum;
  }
  return { players, teams, byId, league };
}

export function posGroup(p) {
  return POS_GROUP[p.pos] ?? 'W';
}

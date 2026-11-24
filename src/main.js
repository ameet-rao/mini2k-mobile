// Browser entry: loads data, runs the fixed 60 Hz update loop, renders with Canvas 2D
// (pixel-art broadcast view in src/render, or the old top-down view as "classic").
// All game logic lives in src/engine (pure); this file only wires input -> engine -> renderer.
//
// URL options (handy for testing):
//   ?user=PHI&opp=BOS&q=5&seed=7&diff=pro   start immediately as PHI vs BOS
//   ?demo=1&home=LAL&away=GSW&speed=4       CPU vs CPU at 4x speed
//   &intro=0 skips the lineup card, &view=classic uses the top-down view

import { buildIndex, POS_ORDER } from './engine/data.js';
import { teamStreetThree } from './engine/game.js';
import { LiveGame } from './engine/live.js';
import { STREET_RULES } from './engine/rules.js';
import { deriveBoxScore } from './engine/boxscore.js';
import { Keyboard } from './ui/input.js';
import { render, VIEW } from './ui/render.js';
import { Broadcast } from './render/broadcast.js';
import { Sound } from './render/audio.js';
import { SW, SH } from './render/view.js';
import { loadPixelFonts } from './ui/pixelfont.js';
import { TouchPad, mergeInput } from './ui/touch.js';

loadPixelFonts();
if (window.__MINI2K_DATA) document.querySelector('.head a')?.remove();   // the one-file build has no roster page

const STEP = 1 / 60;
const $ = (id) => document.getElementById(id);
const canvas = $('game');
const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
const params = new URLSearchParams(location.search);

window.addEventListener('error', (e) => { $('err').textContent = `Error: ${e.message}`; });
window.addEventListener('unhandledrejection', (e) => { $('err').textContent = `Error: ${e.reason?.message ?? e.reason}`; });

// ---------- settings (saved in localStorage) ----------
// Mobile build: the keyboard hint panel is off by default (the buttons are on screen instead).
const DEFAULTS = { view: 'broadcast', scale: 'auto', gameZoom: 1.15, crowd: true, audio: true, volume: 0.6, hints: false, fps: false };
const IS_TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;
const settings = { ...DEFAULTS };
try { Object.assign(settings, JSON.parse(localStorage.getItem('mini2k-mobile.settings') ?? '{}')); } catch { /* private mode */ }
if (params.get('view')) settings.view = params.get('view') === 'classic' ? 'classic' : 'broadcast';
const saveSettings = () => { try { localStorage.setItem('mini2k-mobile.settings', JSON.stringify(settings)); } catch { /* ignore */ } };

function fitCanvas() {
  if (settings.view === 'classic') {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = VIEW.W * dpr; canvas.height = VIEW.H * dpr;
    canvas.className = '';
    canvas.style.width = canvas.style.height = '';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return;
  }
  // pixel view: 640x360 scaled by a whole number, never smoothed
  const ratio = Math.min(window.innerWidth / SW, window.innerHeight / SH);
  const fit = Math.max(1, Math.floor(ratio));
  const full = !!document.fullscreenElement || IS_TOUCH;   // phones: always fill the screen
  // fullscreen fills the whole screen (drawn at the next whole scale up, then fitted); windowed uses whole pixels
  const k = full ? Math.min(5, Math.max(1, Math.ceil(ratio - 0.01)))
    : settings.scale === 'auto' ? fit : Math.max(1, Math.min(Number(settings.scale) || fit, Math.max(fit, 1)));
  const css = full ? ratio : k;
  // the canvas holds real screen pixels (640x360 times a whole number) so the zoomed court stays crisp
  if (canvas.width !== SW * k || canvas.height !== SH * k) { canvas.width = SW * k; canvas.height = SH * k; }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  canvas.className = 'pixel';
  canvas.style.width = `${Math.round(SW * css)}px`; canvas.style.height = `${Math.round(SH * css)}px`;
}
fitCanvas();
window.addEventListener('resize', fitCanvas);

// ---------- fullscreen (button in the menus, or the M key) ----------
function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen?.();
  else document.documentElement.requestFullscreen?.().catch(() => {});
}
document.addEventListener('fullscreenchange', () => {
  fitCanvas();
  for (const b of document.querySelectorAll('.btnFull')) b.textContent = document.fullscreenElement ? 'Exit fullscreen' : 'Fullscreen';
});
for (const b of document.querySelectorAll('.btnFull')) b.addEventListener('click', toggleFullscreen);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyM' || e.repeat || (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName))) return;
  toggleFullscreen();
});

// The single-file build (tools/build_standalone.mjs) embeds the data; otherwise load it from /data.
const [playersJson, teamsJson, appearance] = window.__MINI2K_DATA
  ? [window.__MINI2K_DATA.players, window.__MINI2K_DATA.teams, window.__MINI2K_DATA.appearance]
  : await Promise.all([
    fetch('../data/players.json').then((r) => r.json()),
    fetch('../data/teams.json').then((r) => r.json()),
    fetch('../data/appearance.json').then((r) => r.json()).catch(() => ({ generic: {}, stars: {} })),
  ]);
const sound = new Sound(settings);
const broadcast = new Broadcast(canvas, appearance, settings, sound);
let intro = null;       // { t, dur } while the lineup card is up (the game has not started yet)
const data = buildIndex(playersJson, teamsJson);
const teamIds = Object.keys(data.teams);
const gd = () => live?.data ?? data;

const keys = new Keyboard(window);
// StreetBall: the camera turns round when the away team has the ball, so the keys turn with it
keys.turned = () => !!(live?.street && live.viewSide === 'away');
// Phone controls: joystick + buttons drawn over the game (src/ui/touch.js). Keyboard still works too.
const touch = new TouchPad(document.getElementById('touch'), { turned: keys.turned });
const input = mergeInput(keys, touch);
let live = null, paused = false, speed = 1, acc = 0, last = performance.now(), finalShown = false, finalT = 0, fps = 60;

// ---------- menu ----------
for (const sel of [$('selUser'), $('selOpp')]) {
  for (const id of teamIds) {
    const o = document.createElement('option');
    o.value = id; o.textContent = `${data.teams[id].name} (${Math.round(data.teams[id].team_overall)})`;
    sel.appendChild(o);
  }
}
$('selOpp').value = teamIds[1];
const fixOpp = () => {
  if ($('selOpp').value === $('selUser').value) $('selOpp').value = teamIds.find((t) => t !== $('selUser').value);
};
$('selUser').addEventListener('change', fixOpp);
$('selOpp').addEventListener('change', () => {
  if ($('selOpp').value === $('selUser').value) $('selUser').value = teamIds.find((t) => t !== $('selOpp').value);
});

function start({ home, away, user, quarter = 12, difficulty = 'pro', seed, street = false, lineups = null, mitt = false }) {
  begin(new LiveGame(data, {
    home, away, user, difficulty, lineups,
    seed: seed ?? (Math.floor(Math.random() * 1e9) + 1), // the seed makes the whole game reproducible
    rules: street ? { ...STREET_RULES, difficulty, ...(mitt ? { makeItTakeIt: true } : {}) } : { quarterMinutes: quarter, difficulty },
  }));
}

function begin(L) {
  if (IS_TOUCH && !document.fullscreenElement) document.documentElement.requestFullscreen?.().then(() => screen.orientation?.lock?.('landscape')).catch(() => {});
  live = L;
  const user = L.user;
  window.__live = live; // for debugging / automated checks
  paused = false; finalShown = false; finalT = 0; acc = 0; last = performance.now();
  broadcast.attach(live); broadcast.prewarm();
  window.__broadcast = broadcast;
  intro = params.get('intro') === '0' || settings.view === 'classic' ? null : { t: 0, dur: user ? 9 : 3.5 };
  $('menu').hidden = true; $('pause').hidden = true; $('final').hidden = true; $('streetSetup').hidden = true;
  touch.setGame(true);
  canvas.focus?.();
}

$('btnStart').addEventListener('click', () => start({
  home: $('selUser').value, away: $('selOpp').value, user: 'home',
  quarter: Number($('selQ').value), difficulty: $('selDiff').value,
}));
// ---------- StreetBall: pick any three players for each squad ----------
// One <select> listing every healthy player in the league, grouped by team (cloned for each slot).
const pickOptions = (() => {
  const frag = document.createDocumentFragment();
  for (const t of [...teamIds].sort((a, b) => data.teams[a].name.localeCompare(data.teams[b].name))) {
    const g = document.createElement('optgroup'); g.label = data.teams[t].name;
    const ids = data.teams[t].depth_order.filter((id) => data.byId[id]?.available)
      .sort((a, b) => data.byId[b].overall - data.byId[a].overall);
    for (const id of ids) { const P = data.byId[id], o = document.createElement('option'); o.value = id; o.textContent = `${P.name} (${P.pos}, ${Math.round(P.overall)})`; g.appendChild(o); }
    frag.appendChild(g);
  }
  return frag;
})();
const allHealthy = Object.keys(data.byId).filter((id) => data.byId[id].available);
/** Three selects in `box` showing `ids`; onPick(i, id) when one changes. */
function pickSelects(box, ids, onPick, disabled = false) {
  if (box.children.length !== 3) {
    box.innerHTML = '';
    for (let i = 0; i < 3; i++) {
      const s = document.createElement('select'); s.appendChild(pickOptions.cloneNode(true));
      s.addEventListener('change', () => box._onPick?.(i, s.value));
      box.appendChild(s);
    }
  }
  box._onPick = onPick;
  [...box.children].forEach((s, i) => { s.value = ids[i]; s.disabled = disabled; });
}
/** Who plays the Guard / Wing / Big spot: the engine orders the three by position (then pick order). */
function streetSeatOrder(ids) {
  return ids.map((id, i) => [id, i]).sort((a, b) => POS_ORDER[data.byId[a[0]].pos] - POS_ORDER[data.byId[b[0]].pos] || a[1] - b[1]).map((x) => x[0]);
}
const randomThree = (not) => { const out = []; while (out.length < 3) { const id = allHealthy[Math.floor(Math.random() * allHealthy.length)]; if (!out.includes(id) && !not.includes(id)) out.push(id); } return out; };
const dupOf = (picks) => { const all = [...picks.home, ...picks.away]; return all.find((id, i) => all.indexOf(id) !== i) ?? null; };

const street = { picks: null };
for (const sel of [$('stTeamHome'), $('stTeamAway')]) for (const id of teamIds) { const o = document.createElement('option'); o.value = id; o.textContent = data.teams[id].name; sel.appendChild(o); }
function streetRender() {
  for (const side of ['home', 'away']) {
    const box = $(side === 'home' ? 'stPicksHome' : 'stPicksAway');
    pickSelects(box, street.picks[side], (i, id) => { street.picks[side][i] = id; streetRender(); });
  }
  const dup = dupOf(street.picks), same = $('stTeamHome').value === $('stTeamAway').value;
  $('stStatus').textContent = dup ? `${data.byId[dup].name} is picked twice. Each player can only play once.` : same ? 'Pick different jerseys for the two squads.' : '';
  $('btnStGo').disabled = !!dup || same;
}
function showStreetSetup() {
  if (!street.picks) {
    $('stTeamHome').value = $('selUser').value; $('stTeamAway').value = $('selOpp').value;
    street.picks = { home: teamStreetThree(data, $('stTeamHome').value), away: teamStreetThree(data, $('stTeamAway').value) };
  }
  $('menu').hidden = true; $('streetSetup').hidden = false;
  streetRender();
}
for (const [id, side] of [['stTeamHome', 'home'], ['stTeamAway', 'away']]) {
  $(id).addEventListener('change', () => { street.picks[side] = teamStreetThree(data, $(id).value); streetRender(); });
}
$('stRandHome').addEventListener('click', () => { street.picks.home = randomThree(street.picks.away); streetRender(); });
$('stRandAway').addEventListener('click', () => { street.picks.away = randomThree(street.picks.home); streetRender(); });
$('btnStBack').addEventListener('click', () => { $('streetSetup').hidden = true; $('menu').hidden = false; });
$('btnStreetCpu').addEventListener('click', showStreetSetup);
$('btnStGo').addEventListener('click', () => {
  if (dupOf(street.picks)) return;
  $('streetSetup').hidden = true;
  start({
    home: $('stTeamHome').value, away: $('stTeamAway').value, user: 'home', difficulty: $('selDiff').value, street: true, mitt: $('stMitt').value === '1',
    lineups: { home: [...street.picks.home], away: [...street.picks.away] },
  });
});
$('btnDemo').addEventListener('click', () => start({
  home: $('selUser').value, away: $('selOpp').value, user: null,
  quarter: Number($('selQ').value), difficulty: $('selDiff').value,
}));

function setPaused(v) {
  if (!live || live.phase === 'final' || !$('menu').hidden) return;
  paused = v;
  if (v) { toPanel = null; pauseMode(false); renderCoach(); }
  $('pause').hidden = !v;
  last = performance.now();
}
keys.onPause = () => setPaused(!paused);
touch.onPause = () => setPaused(!paused);
touch.onTap = () => { if (intro && intro.t > 0.4) intro = null; };

// ---------- coach menu (inside the pause overlay): timeout + substitutions ----------
function renderCoach() {
  const on = !!(live && live.user && !live.street);     // StreetBall: no timeouts or subs
  $('coach').hidden = !on;
  if (!on) return;
  const side = live.user, team = live.state.teams[side], rules = live.game.rules;
  const left = team.timeouts;
  $('btnTimeout').disabled = left <= 0 || live.wantTimeout;
  $('btnTimeout').textContent = `Call timeout (${left} left)`;
  $('timeoutNote').textContent = live.wantTimeout ? 'Timeout will be called as soon as your team has the ball.' : left <= 0 ? 'No timeouts left.' : '';
  $('autoSubs').checked = !!live.game.autoSubs[side];
  const box = deriveBoxScore(live.game.events);   // stats come from the event log only
  const statOf = (sd, id) => box[sd].players[id] ?? { pts: 0, reb: 0, ast: 0, blk: 0, stl: 0, sec: 0 };
  const line = (id) => {
    const p = gd().byId[id], en = Math.round((team.energy[id] ?? 1) * 100);
    return { p, en, pf: team.pf[id] ?? 0 };
  };
  const bench = team.roster.filter((id) => !team.onCourt.includes(id) && gd().byId[id].available && (team.pf[id] ?? 0) < rules.foulOutLimit);
  const rows = team.onCourt.map((id) => {
    const { p, en, pf } = line(id);
    const pend = live.pendingSubs.find((w) => w.out === id)?.in ?? '';
    const opts = bench.map((b) => {
      const l = line(b);
      return `<option value="${b}"${b === pend ? ' selected' : ''}>${l.p.name} (${l.p.pos}, ${Math.round(l.p.overall)} ovr, ${l.en}%, ${l.pf} PF)</option>`;
    }).join('');
    return `<tr><td>${p.pos}</td><td>${p.name}</td><td>${Math.round(p.overall)}</td><td class="${en < 45 ? 'low' : ''}">${en}%</td><td class="${pf >= rules.foulOutLimit - 2 ? 'low' : ''}">${pf}</td><td>${statOf(side, id).pts}</td>`
      + `<td><select data-out="${id}"><option value="">stays in</option>${opts}</select></td></tr>`;
  });
  $('subTable').innerHTML = `<tr><th>Pos</th><th>On the floor</th><th>Ovr</th><th>Energy</th><th>PF</th><th>PTS</th><th>Sub in</th></tr>${rows.join('')}`;
  // full stat list for both teams (your team first), everyone on the roster
  const sides = [side, side === 'home' ? 'away' : 'home'];
  $('statTable').innerHTML = sides.map((sd) => {
    const T = live.state.teams[sd];
    const ids = T.roster.filter((id) => gd().byId[id].available || box[sd].players[id]);
    ids.sort((a, b) => (T.onCourt.includes(b) - T.onCourt.includes(a)) || (statOf(sd, b).pts - statOf(sd, a).pts) || (statOf(sd, b).sec - statOf(sd, a).sec));
    const rowsS = ids.map((id) => {
      const l = statOf(sd, id), on = T.onCourt.includes(id);
      return `<tr class="${on ? 'on' : ''}"><td>${on ? '>' : ''}</td><td>${gd().byId[id].name}</td><td>${l.pts}</td><td>${l.reb}</td><td>${l.ast}</td><td>${l.blk}</td><td>${l.stl}</td></tr>`;
    }).join('');
    return `<tr class="team"><th></th><th>${gd().teams[T.id]?.name ?? T.id}</th><th>PTS</th><th>REB</th><th>AST</th><th>BLK</th><th>STL</th></tr>${rowsS}`;
  }).join('');
  const n = live.pendingSubs.length;
  const atEnd = toPanel ? 'when the timeout ends' : 'at the next dead ball';
  $('subNote').textContent = n ? `${n} substitution${n > 1 ? 's' : ''} will be made ${atEnd}.`
    : 'Pick a bench player next to anyone on the floor. The change happens at the next dead ball.';
}
$('subTable').addEventListener('change', (e) => {
  const sel = e.target.closest('select');
  if (!sel || !live) return;
  live.requestSub(sel.dataset.out, sel.value || null);
  renderCoach();
});
$('autoSubs').addEventListener('change', () => {
  if (!live?.user) return;
  live.game.autoSubs[live.user] = $('autoSubs').checked;
});
$('btnTimeout').addEventListener('click', () => {
  if (!live?.user) return;
  live.wantTimeout = true; renderCoach();
});
// ---------- timeout: the coach menu opens by itself and the subs go in when the timeout ends ----------
let toPanel = null;          // { st } while the timeout screen is open
function pauseMode(timeout) {
  $('timeoutRow').style.display = timeout ? 'none' : '';   // no new timeout from inside a timeout
  $('btnResume').textContent = timeout ? 'Back to the game' : 'Resume';
  if (!timeout) { $('pauseTitle').textContent = 'Paused'; $('pauseSub').innerHTML = 'Press <kbd>P</kbd> or <kbd>Esc</kbd> to resume.'; }
}
function timeoutPanel() {
  const q = live?.phase === 'anim' ? live.queue[0] : null;
  const st = q?.started && q.k === 'timeout' && live.user ? q : null;
  if (st && !paused && $('menu').hidden) {
    if (!toPanel || toPanel.st !== st) {
      toPanel = { st, closed: false };
      pauseMode(true); renderCoach(); $('pause').hidden = false;
    }
    if (toPanel.closed) return;
    const who = live.state.teams[st.ev.team].id, left = Math.max(0, Math.ceil(st.dur - st.t));
    $('pauseTitle').textContent = `Timeout ${who} · ${left}`;
    $('pauseSub').textContent = 'Make your substitutions now. They go in when the timeout ends.';
  } else if (toPanel) {
    if (!paused) { $('pause').hidden = true; canvas.focus?.(); }
    pauseMode(false); toPanel = null;
  }
}
// keep the coach menu current while it is open online or in a timeout (requests confirmed by the game show up)
setInterval(() => { if (live && toPanel && !toPanel.closed && !document.activeElement?.closest?.('#subTable')) renderCoach(); }, 600);
window.addEventListener('keydown', (e) => {
  if (e.code !== 'KeyH' || e.repeat || !live || (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName))) return;
  settings.hints = !settings.hints; saveSettings();
  for (const o of document.querySelectorAll('.setHints')) o.checked = settings.hints;
});
window.addEventListener('keydown', (e) => { if (intro && (e.code === 'Space' || e.code === 'Enter') && intro.t > 0.4) intro = null; });

// settings controls (menu + pause share the same elements by class)
const bindSetting = (cls, key, parse = (v) => v) => {
  for (const el of document.querySelectorAll(`.${cls}`)) {
    if (el.type === 'checkbox') el.checked = !!settings[key]; else el.value = String(settings[key]);
    el.addEventListener('change', () => {
      settings[key] = el.type === 'checkbox' ? el.checked : parse(el.value);
      for (const o of document.querySelectorAll(`.${cls}`)) { if (o.type === 'checkbox') o.checked = !!settings[key]; else o.value = String(settings[key]); }
      saveSettings(); fitCanvas(); sound.apply();
    });
  }
};
bindSetting('setView', 'view'); bindSetting('setScale', 'scale', (v) => (v === 'auto' ? 'auto' : Number(v)));
bindSetting('setZoom', 'gameZoom', Number); bindSetting('setCrowd', 'crowd'); bindSetting('setAudio', 'audio');
bindSetting('setVolume', 'volume', Number); bindSetting('setHints', 'hints'); bindSetting('setFps', 'fps');
$('btnResume').addEventListener('click', () => {
  if (toPanel && !paused) { toPanel.closed = true; $('pause').hidden = true; pauseMode(false); canvas.focus?.(); return; }   // timeout screen: just close it
  setPaused(false);
});
$('btnQuit').addEventListener('click', () => {
  live = null; paused = false; $('pause').hidden = true; touch.setGame(false); $('menu').hidden = false; });
$('btnAgain').addEventListener('click', () => {
  const wasStreet = !!live?.street;
  live = null; $('final').hidden = true; touch.setGame(false);
  if (wasStreet) showStreetSetup(); else $('menu').hidden = false;
});
document.addEventListener('visibilitychange', () => { if (document.hidden && live && live.user) setPaused(true); });

function showFinal() {
  finalShown = true;
  const box = deriveBoxScore(live.game.events); // box score comes from the event log only
  const t = live.state.teams;
  $('finalScore').textContent = `${t.away.id} ${box.final.away}  ·  ${t.home.id} ${box.final.home}`;
  const rows = [];
  for (const side of ['away', 'home']) {
    const top = [...box[side].order].sort((a, b) => box[side].players[b].pts - box[side].players[a].pts).slice(0, 3);
    for (const id of top) {
      const l = box[side].players[id];
      rows.push(`<tr><td>${t[side].id} · ${gd().byId[id].name}</td><td>${l.pts}</td><td>${l.reb}</td><td>${l.ast}</td><td>${l.fgm}-${l.fga}</td><td>${l.tpm}-${l.tpa}</td></tr>`);
    }
  }
  $('finalTable').innerHTML = `<tr><th>Top scorers</th><th>PTS</th><th>REB</th><th>AST</th><th>FG</th><th>3P</th></tr>${rows.join('')}`;
  $('final').hidden = false;
}

// ---------- loop ----------
function frame(now) {
  const dt = Math.min(0.25, (now - last) / 1000);
  last = now;
  if (dt > 0) fps += (1 / dt - fps) * 0.05;
  if (live) {
    if (intro) { intro.t += dt; if (intro.t >= intro.dur) intro = null; }
    const stopped = paused || intro;
    if (!stopped) {
      acc += dt * speed;
      let n = 0;
      while (acc >= STEP && n++ < 240) {
        live.update(STEP, live.user ? input.snapshot() : undefined);
        input.clearEdges();
        acc -= STEP;
      }
      if (n >= 240) acc = 0;
    } else input.clearEdges();
    const frozen = paused;
    if (settings.view === 'classic') render(ctx, live);
    else broadcast.frame(frozen ? 0 : dt, { intro: intro ? Math.max(0.001, intro.t / 2.2) : 0, alpha: frozen || intro ? 1 : Math.min(1, acc / STEP), fps });
    touch.update(live);
    timeoutPanel();
    if (live.phase === 'final' && !finalShown && (live.phaseT ?? 9) >= 0) { finalT += dt; if (finalT > 2.5) showFinal(); }
  } else {
    ctx.fillStyle = '#0d1117'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// ---------- URL quick start ----------
speed = Math.max(0.25, Math.min(16, Number(params.get('speed') ?? 1) || 1));
const pick = (k) => (teamIds.includes((params.get(k) ?? '').toUpperCase()) ? params.get(k).toUpperCase() : null);
const seed = params.get('seed') ? Number(params.get('seed')) : undefined;
const q = [2, 5, 6, 8, 12].includes(Number(params.get('q'))) ? Number(params.get('q')) : 12;
const diff = ['easy', 'rookie', 'pro', 'allstar'].includes(params.get('diff')) ? params.get('diff') : 'pro';
if (params.get('demo')) {
  const home = pick('home') ?? teamIds[0];
  start({ home, away: pick('away') ?? teamIds.find((t) => t !== home), user: null, quarter: q, difficulty: diff, seed });
} else if (pick('user')) {
  const home = pick('user');
  const away = pick('opp') && pick('opp') !== home ? pick('opp') : teamIds.find((t) => t !== home);
  start({ home, away, user: 'home', quarter: q, difficulty: diff, seed });
}
window.__setSpeed = (v) => { speed = v; };


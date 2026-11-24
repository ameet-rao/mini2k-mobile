# NBA Quick Game — project brief for Claude Code

Personal-use, ~2014-era-2K-fidelity **quick game** in the browser. Real players, 30 teams
(PHI, BOS, LAL, GSW, SAS, OKC, NYK, HOU, WAS, CHI, TOR, CLE, DEN, MIA, POR, LAC, CHA, MIL, DET, MIN), full rosters incl. bench. Stats-driven sim, regular 12-minute quarters.
Art (portraits, courts, menus) comes later from Higgsfield; placeholders until then.

## Stack & rules
- Browser, **vanilla JS ES modules + Canvas 2D**, no build step. Serve with `python3 -m http.server 8000`
  from the repo root, open http://localhost:8000/src/index.html. (`fetch()` needs a server, not file://.)
- Keep the engine **pure and headless** (no DOM/canvas inside `src/engine/`) so it can be unit-tested and
  simulated 1000x from Node: `node tools/sim_check.mjs`.
- Fixed-timestep loop (60 Hz update), render decoupled. Seeded RNG (`mulberry32`) so games are reproducible.
- Never hard-code ratings. Everything reads `data/players.json` and `data/teams.json`.
- Do not edit `data/*.json` by hand — edit `tools/raw_data.py` / `data/overrides.json` and run
  `python3 tools/build_ratings.py`.

## Data (already built — read these first)
- `data/players.json` — 534 players. Per player: `id, team, name, number, pos, height_in, age, roster_status,
  injury, available, overall (45-99), attrs{19 x 25-99}, traits[], tendencies{usage_per36, three_rate,
  fta_per36, pf_per36, tov_per36, ast_per36, mpg_role}, per36{...}, sample{confidence}, role`.
- `attrs`: three_pt, mid_range, free_throw, finishing, dunk, draw_foul, passing, ball_handle, speed,
  athleticism, strength, off_rebound, def_rebound, perimeter_def, interior_def, steal, block, stamina, usage.
- `data/teams.json` — colors, `default_starters` (5 ids), `depth_order` (all ids, starters first,
  injured last), `team_overall`.
- `available:false` players (Butler, Moody, Porzingis) are injured: show on roster, not selectable to play.
- `roster_status:"reserve"` guys have no 2026-27 games; their ratings are replacement-level priors
  (`sample.confidence:"none"`). Fine for end-of-bench.

## Rules to implement (NBA)
- 4 x 12:00 quarters (menu option: 2/5/6/8/12 min), 5:00 OT (2:00 OT with 2-minute quarters), tied -> OT.
- 24s shot clock (reset to 24 on made FG/def rebound/turnover; 14 on off rebound/kicked ball/foul-restart
  in frontcourt), 8s backcourt, 5s inbound, 3-in-the-key optional, no hand-check.
- Fouls: shooting / non-shooting / offensive; 6 personal = foul-out; team fouls -> bonus at 5 per quarter
  (2 FT); and-1; 2:00 rule optional. Flagrant/technical: skip for v1.
- Free throws, 3-pt shots (3 FT on 3-pt foul), substitutions on dead balls, 7 timeouts/team (menu).
- Overtime, end-of-quarter heave, quarter-end buzzer (shot in air counts).
- Auto-sub AI: fatigue (stamina attr drains by minutes + sprinting), foul trouble (e.g., 2 in Q1, 3 in
  1H, 4 before 8:00 Q4), blowout garbage time -> bench.

## Sim model (v1 = possession-resolution, visual layer on top)
1. Possession starts: pick ball-handler (usage-weighted), advance clock by pace draw (~14-20s).
2. Pick action: drive / pull-up / catch&shoot 3 / post / pass-around, weighted by `usage`, `three_rate`,
   position, defender quality.
3. Shot probability = base by shot type from shooter attr (`three_pt`, `mid_range`, `finishing`, `dunk`)
   minus defender contest (`perimeter_def` / `interior_def`), + fatigue penalty, + small hot/cold streak.
   Calibrate so league-like output: ~113 pts/team, 47% FG, 36% 3P, 78% FT, ~99 possessions, 14 TOV, 20 PF.
4. Rebound: `off_rebound` vs `def_rebound` + `strength` weighted by who is on court.
5. Fouls from `draw_foul` of attacker vs `pf_per36` tendency of defender.
6. Log every event to play-by-play; derive the box score from that log (never track separately).
7. Add `tools/sim_check.mjs`: sim 150 games per matchup (default; `--games N`), print averages, fail if outside tolerance.

## Build order (1-hour MVP -> then polish)
1. **Data + loader + roster viewer** (done: scaffold `src/index.html`).               ~5 min
2. **Engine v1**: clock, possessions, shots, rebounds, fouls, FTs, subs, OT.           ~20 min
3. **Court view (2D top-down)**: 10 dots w/ jersey numbers, ball, simple movement
   to spots; shot/pass animations are cosmetic.                                        ~15 min
4. **Controls**: keyboard — arrows/WASD move, Space shoot, E pass, Q switch player,
   Shift sprint, F steal; AI plays everything else. Gamepad later.                     ~10 min
5. **HUD + box score + play-by-play + sub screen** (pause overlay).                    ~10 min
6. Menus: team select, quarter length, difficulty, game over -> box score.
7. Polish: Higgsfield portraits (`assets/portraits/<id>.png`), court art, UI, sound,
   Three.js low-poly court, replays, 82-game season mode (later).

## Definition of done for MVP
- Pick any 2 of 4 teams, play a full game vs CPU with real rosters, subs work, fouls/bonus/foul-outs
  work, shot clock violations occur, box score matches play-by-play, game ends with OT if tied.
- `node tools/sim_check.mjs` passes the league-average tolerances.

## Art pipeline (Higgsfield, later)
Portraits: 512x512 PNG, transparent bg, filename = player `id`. Courts: top-down 1880x1000 per team.
UI kit in `assets/ui/`. Code must fall back to colored circles + numbers when an image is missing.

## Known data caveats
Small samples (9-11 games); 2025-26 blended at 0.6. Defense/speed/handle/strength/athleticism are proxies.
See `docs/RATINGS.md`. Two labeled judgment overrides (Draymond Green, Matisse Thybulle).

## Status (update after each milestone)
- M1 done: pure engine in `src/engine/` (`game.js`, `rules.js`, `model.js`, `subs.js`, `boxscore.js`, `pbp.js`). `node tools/sim_check.mjs` and `node tools/test_rules.mjs` pass.
- M2 + M3 done: real-time layer `src/engine/live.js` (+ `ai.js`, `court.js`), renderer `src/ui/render.js`, keyboard `src/ui/input.js`, entry `src/main.js`. `node tools/live_check.mjs` plays full games headless.
  The real-time layer decides positions/timing and calls engine primitives (`resolveShot`, `defensiveFoul`, `turnover`, ...) for outcomes, then animates the events the engine logged.
- Tuning lives in `MODEL` (model.js), `TUNE` and `DIFFICULTY` (ai.js). Never tune by editing ratings.
- Graphics upgrade done (see docs/GRAPHICS_BRIEFING.md): pixel-art broadcast view in `src/render/` (procedural rig, 71 animations, state machine in `actors.js`, HUD, WebAudio), sprite viewer `tools/sprite_viewer.html`, looks in `data/appearance.json`. CPU timeouts and open-shot timing were added before the golden baseline; `node tools/golden.mjs` must stay PASS for render-only work.
- Shot contest: `LiveGame.contest(e)` scores 0..1 from proximity, hands up and coverage, mapped to 8 tiers (Wide Open .. Smothered); it sets the make modifier (`contestMod`) and shrinks the meter's green window. A Perfect release makes `PERFECT_MAKE` (90%). Golden baseline was re-recorded after this change.
- Batch 3 (golden re-recorded): deep-range green window (`m.deep` in `meterContest`, `GREEN_SCALE` 0.9), pick and roll (`e.screen`/`e.roll` in ai.js, `TUNE.pickRoll`), manual subs and timeout from the pause menu (`LiveGame.requestSub`, `pendingSubs`, `wantTimeout`; a manual sub turns `game.autoSubs[user]` off), 103 animations, whole-picture zoom (`settings.gameZoom`, `Broadcast.present()` draws the 640x360 scene zoomed and the HUD unzoomed), side controls panel (`Hud.controls`, H toggles).
- Single-file build: `node tools/build_standalone.mjs` writes `dist/mini2k.html` (modules embedded as text, loaded via blob URLs, data in `window.__MINI2K_DATA`); rebuild and commit it after changes. Fullscreen: M key or `.btnFull` buttons; `play.bat` starts the dev server on Windows.
- Scoring 15% harder in the real-time game (`SCORE_HARD`, `DUNK_HARD` for contested dunk-range finishes, passed to `resolveShot` as `makeScale`; Perfect stays 90%); CPU now averages about 101 points, 40% FG. Pick and roll for the user's team is called with R (`LiveGame.callPick`); the CPU still runs it on its own. Golden re-recorded.
- Batch 5 (golden re-recorded): 14 teams / 253 players with real listed heights (sprites scale by `height_in`); skin tones per player in `data/appearance.json` `tones` (estimates, edit there); scoring another 25% harder (`SCORE_HARD` 0.85*0.75, `DUNK_HARD` 0.8*0.75; CPU now about 71 points, 28% FG, on purpose; live_check band widened); tough-angle shots (`LiveGame.toughAngle`: behind the backboard, hugging the sideline/baseline) shrink the green window and cut the make chance; free throws and rebounds are deferred engine outcomes (`game.deferred`, `state.pending`, `freeThrow({makeProb})`, `resolveRebound(mult, norm)`) so players walk to the line (`ftsetup`/`ftaim` steps, clock stopped), the user shoots FTs on a meter, and everyone keeps moving and can fight for the board while the shot is in the air (`rebMult`, `REB_NORM`); pump fake on a quick Space tap (`TAP_FAKE`, sets `pivot`: no more dribbling); alley-oop (Q on offense, `callOop`/`lob`); double team (R on defense, `callDouble`); 170 animations with per-player packages (`style(e)` in actors.js).
- Pixel menus: `src/ui/pixelfont.js` builds TrueType fonts in memory from the canvas bitmap fonts (`GLYPHS` in render/font.js) and registers "Mini2K Pixel" and "Mini2K Tiny" with FontFace; menu, pause, final and roster pages use them with stepped pixel borders (CSS in index.html). Use font sizes in multiples of 10px.
- Pause screen: PTS column in the coach table and a "Player stats" table (PTS REB AST BLK STL, both full rosters, `>` = on the floor), all from `deriveBoxScore(live.game.events)`.
- Online two-player (see docs/ONLINE.md): `LiveGame` takes `user:'both'` (`humans`, per-side `uc[side]`; `user` is only the side this screen shows, the engine never reads it), inputs may be `{home, away}` and carry `lag` for meter/jump timing. Netcode in `src/net/` (host authority, input frames, requests applied at the same step, catch-up/snap, snapshots, fingerprints). `node tools/net_check.mjs` must PASS. Build `node tools/build_standalone.mjs --online` -> `dist/mini2k-online.html`.
- ar-fork branch (AR's own meter: location-based green/orange, `startMeter`/`meterContest`/`calcOrangeProb`): the online guest times its own shots by counting how long Space is held on its screen and sends the count with the release inside the input frame (`f[4]`, `input.hold`, judged by `perceived()` in live.js, kept within 0.35 s of the running meter); its meter is drawn from that count (`L.viewMeter`/`viewFtMeter`, display only). Never let one screen decide a result outside the frames: that desynced every shot (fast-forward, then freeze). Dribble moves (C, Shift blow-by) and layup drive ported from main.
- TURN (v13): relay settings read live at Create/Join (`readNet`), merged from both sides (`mergeIce`; guest sends its ICE in `hello`), `turnUrls` normalizes addresses and adds TCP, `relayCheck` warns when no relay candidate, guest retries relay-only after 9 s (`hello {relay:true}` -> `hostOffer(ice, true)`). Test with node-turn in the scratchpad, never as a repo dependency.
- Timeouts (v14): `TIMEOUT_SECS` 10 in live.js; during a timeout step the coach menu opens by itself on both screens (`timeoutPanel()` in main.js, no pause, countdown title) and pending subs go in at the dead ball right after it.
- Relay server (another thread): `src/net/peer.js` `ServerLink`/`serverBase`/`wakeServer`, `netServer` setting, `onVia` 'server'. The page is also deployed as `public/index.html` in GitHub `ameet-rao/mini2k-relay` (Render); copy `dist/mini2k-online.html` there after each online change.
- Difficulty (v15): `DIFFICULTY` in ai.js has `easy` (Super Easy: `classicGreen()` = the v10 green window in seconds, never below Rookie's), Rookie/Pro greens +10% (`greenScale` 1.65/1.1; `orangeScale` keeps the old orange), All-Star unchanged.
- v16 (golden re-recorded): dead dribble (`e.dribbled`, set by moving with the ball or a C move; `pumpFake` only sets `pivot` if dribbled; reset on pass/shot/new possession); pick and pop (`popChance` in ai.js from `three_pt` and `tendencies.three_rate`, rolled every screen; else roll); dribble moves have ball paths (`bp` in anims.js, drawn in `Broadcast.ballView`) and `~run` copies with stepping legs (`DRIBBLE_MOVES`, chosen in `Actors.play` when moving); C sideways cycles shift/crossover/between_legs/behind_back (`SIDE_MOVES`).
- v17 (golden re-recorded: league baselines moved with the new players): POR, LAC, CHA, MIL, DET, MIN added from basketball-reference (team pages read 2026-11-19, appended to `data/sources`), kits in sprites.js, tones/looks in appearance.json; 2-minute quarter option (OT = min(5, quarter) in `periodLength`); pump fake cooldown `FAKE_COOLDOWN` 2 s (a tap inside it just cancels the meter).
- v18 (golden re-recorded): all 30 teams (ATL, BKN, DAL, IND, MEM, NOP, ORL, PHX, SAC, UTA added from basketball-reference, read 2026-11-19); V = spin move (input bit 12, `spin`), slow on purpose (about 40% speed with a curl away from the defender); C toward the hoop = `in_and_out` (60% speed, no burst); after a pump fake the user pivots around `pivotAt` (`PIVOT_STEP`), can't move or dribble; a shot that goes out of bounds is the defense's ball unless it was blocked (`resolveRebound`); user drive fouls via `foulScale()` (10% fewer, 55% when no `realContest`); layup contest locked at layup start (`m.c0`/`m.d0`), late defenders capped at Heavy (`LATE_CAP`), rim contest weighted by height/block; `layupGreen` 1.5 on Super Easy, Rookie and Pro.
- v19 2v2 online ("Play 2v2 Online" button, separate from the other modes): `LiveGame` `opts.seats` makes per-person controllers (`ctls`, `uc[key]` with `side` and `roles`; keys and positions in `SEAT_KEYS`/`SEAT_ROLES`: 'home'/'away' = PG+C, 'home2'/'away2' = SG+SF+PF; empty seats are CPU). Engine helpers `ctlOf`, `owns`, `mine`, `give`, `assignAll`; `roles()` moves a controller off a player whose position changed after a sub; off the ball on offense the CPU runs your man unless you hold a direction, Q switches between your own players. `L.me` = this screen's key (display only). Netcode: `Session(..., { multi: true })`, frames `[cmds|0, bits, lag, hold per key]`, everything through one room on the Mini2K server (`HubLink` in peer.js; `to`/`from` on messages, host id 'host'); lobby (seats, teams, rejoin by name) in main.js. `node tools/net4_check.mjs` must PASS (args: latency jitter quarter hostKey emptySeat). Relay `MAX_IN_ROOM` raised to 8.
- v20 "Online now" list on the main menu (`src/net/presence.js`, panel `#presence`): type a name and press Show me; green dot = active in the last 2 min, time online, what they are doing. Cheap on purpose: one POST to `/presence` on the Mini2K server every 60 s (30 s while the menu is showing), none after 15 min idle (server drops idle 15 min or silent 150 s); the reply is the list. Server state in memory only (`people` in server.js). Pages on Railway and the double-click file (built-in Render server) see separate lists.
- v21 Multiplayer menu button ("Multiplayer (2v2 / 3v3)", same lobby as v19): room creator picks the mode (`o2Mode`). `MODES` in live.js holds each mode's positions and labels; 3v3 seats 'home'/'home2'/'home3' = PG+SG / SF / PF+C. The start config carries `mode` and `roles` (`opts.seatRoles`), so every screen builds the same controllers. `SEAT_KEYS` now lists all six keys. Relay `MAX_IN_ROOM` 10. Check both: `node tools/net4_check.mjs` (2v2) and `node tools/net4_check.mjs 80 40 2 home3 away2 3v3`.
- v24 StreetBall 3on3 (its own mode; every other mode is bit-for-bit unchanged, checked by state hashes): `STREET_RULES` in rules.js (`rules.street`): 3 a side (`streetThree` picks best guard, best big, best other starter; roles 0/2/4 so they space like PG/wing/big), first to 21 by 1s and 2s (`STREET_POINTS`), win by two (`streetWinner`, checked in `addPoints`), no fouls of any kind, no free throws, timeouts or subs, no game clock, 12 s shot clock, coin flip instead of a tip. Live layer: every change of possession is a check ball at the top of the key (`startCheck`, phase 'check', `CHECK_SECS`); offensive rebounds play on; everybody stays in the half being played (`courtSide`), the ball handler stepping over midcourt is out of bounds. Each team plays at its own end, so the check ball cut makes the camera flip sides. Look: `src/render/street.js` (`StreetArena`: blacktop, fence, skyline, chain nets, no refs/benches), close camera (whole-picture zoom 1.5, framed on the basket being played), street score bug. Menu: "StreetBall 3on3 online" (lobby mode `street`, seats Guard / Wing / Big, open spots CPU) and "StreetBall vs CPU" (offline). Check: `node tools/net4_check.mjs 120 60 3 away '' street`.
- v25 StreetBall fixes (AR, 2026-11-21): both teams now play at ONE basket (`dirRight` is always true in street). Steals and blocked shots that change possession: check ball. A defensive rebound off a miss plays on with the clear rule (`mustClear`): a shot before the ball gets past the arc is a turnover (`not_cleared`), CPU handlers dribble out first (`clearPoint`), the arc lights up (`Broadcast.clearArc`). Camera: 180-degree swivel round the middle of the half court on each change of possession (`L.viewSide`; `Camera.rot`/`rw` turn world points, `StreetArena.drawCourt` turns the texture, sprites mirror via `Actors.viewFlip`, keys turn too via `Keyboard.turned`). Pick any 3 healthy players per squad (`opts.lineups`, validated in `makeTeam`): "StreetBall vs CPU" setup screen (`#streetSetup`) and lobby picks (`st.picks`, message `pick`, host refuses duplicates, `cfg.lineups`).
- v26 (AR, 2026-11-21): no live "clear the ball" any more (AR: the swivel turned the keys mid-play and the rebounder ran out of bounds). Every change of possession except an offensive rebound is a reset walk (phase 'clear', `updateClear`, no body collisions): the rebounder/stealer (else the guard) carries the ball to the top of the arc, everyone walks to their spots while the camera swivels, then the check ball (phase 'check'), then live. `mustClear` code is left in but never set.
- v27 (AR, 2026-11-23): StreetBall make-it take-it option (`rules.makeItTakeIt`, vs CPU setup `stMitt`, online lobby `o2Mitt` / cfg.mitt; game.js keeps possession after a make). Online StreetBall: one person can sit in several spots on a team (seat clicks toggle); at tip-off his spots merge into his first seat key with the combined roles (cfg.roles), so he switches between them like 3v3. Low 3D camera was discussed and skipped by AR for now. Other modes: state hashes identical to v26.
- v28 Franchise mode (AR, 2026-11-23, PRD `franchise-mode-PRD.md` in the project folder): a first screen picks Franchise or Play Mode (`#modeSelect`; Play Mode = the old menu, untouched; `?mode=franchise` opens it directly; URL quick starts skip the screen). Pure engine in `src/franchise/` (no DOM except `ui.js`/`store.js`): `sim.js` possession box-score sim calibrated to NBA averages (played games keep Mini2K scoring), `cba.js` cap/tax/aprons as ratios of the cap, `contracts.js`, `trade.js` (validation, AI value, up to 4 teams), `draft.js` (prospects, 3-2-1 lottery), `progression.js`, `league.js`, `season.js` (phase machine), `adapter.js` (league rosters -> `LiveGame` data; live event log -> franchise box score), `store.js` (IndexedDB + gzip export), `ui.js` (all screens). Extra data in `data/franchise.json` built by `tools/build_franchise.py` from basketball-reference contracts/advanced pages (read 2026-11-23, in `data/sources`); players.json untouched. Check: `node tools/franchise_check.mjs [seasons] [seed]` must PASS. main.js only gained `gd()` (pause screen reads the game's own data) and the `live.franchise` hand-off in `showFinal`/`btnQuit`.
- v29 (AR, 2026-11-23): Trade Finder on the Phone screen (`findTrades` in trade.js, `vFinder` in ui.js): tick your own players/picks, pick a goal (`FINDER_GOALS`: best value, win now, young players and picks, cap relief), every other team answers with its best package it would accept and that passes `validateTrade` (picks only, 1 or 2 players, plus at most 2 picks); "Open" loads it into the trade table. Checked in franchise_check.
- Not done: instant replay, Higgsfield static art (logos, title), manual free throws.
- Next: M4 (full HUD, pause/sub screen, box score, play-by-play, menus), M5 (calibrate the real-time game, difficulty, late-game fouling/clock management), M6 art.

## Mini2K Mobile (separate project, 2026-11-24)
This copy is the phone build, split off from v29 (ar-fork/franchise). It does NOT track the main game.
- Removed: Franchise mode (`src/franchise`, `data/franchise.json`), every online mode (`src/net`, lobbies, presence), the start screen. Kept: Quick game vs CPU, StreetBall vs CPU, Watch CPU vs CPU, pause/subs/timeouts. `src/engine` and `src/render` are unchanged from v29 (golden PASS).
- Touch controls: `src/ui/touch.js` (`TouchPad`, `mergeInput`). Floating joystick on the left half (past the ring = sprint), buttons on the right that relabel with possession: SHOOT/BLOCK (hold), PASS/STEAL, LOB/SWITCH, PICK/DOUBLE, MOVE, SPIN (offense only), SPRINT (hold), top: II pause, TO timeout. Keyboard still works.
- Phones always use the fill-the-screen canvas scale; a game start asks for fullscreen + landscape lock (Android); portrait shows a "turn your phone" screen. Settings saved under `mini2k-mobile.settings`.
- Build: `node tools/build_standalone.mjs` -> `dist/mini2k-mobile.html`.

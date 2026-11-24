# Graphics Upgrade Briefing: pixel-art broadcast view with animated players

Audience: Claude Code, working in the existing repo. This **extends** `CLAUDE.md` and `docs/BRIEFING.md`.
The simulation and basic game already exist (players are currently numbered discs). Your job is the
**presentation layer only**: real animated pixel-art players, a 2K-style broadcast camera, and the
surrounding game-day presentation.

Style reference: `docs/ref/pixel_style_ref.png` (chunky 1px dark outline, 2-3 tone shading, readable chest
number, dynamic pose). Match that feel, with a bit more detail. Use it for style only; do not copy the image.

---------------------------------------------------------------------------------------------------

## 0. HARD RULES (frozen, do not change)

The user's one non-negotiable: **gameplay must not change.** Specifically do NOT modify:
- `data/*.json`, ratings, attributes, `tools/build_ratings.py`, `tools/raw_data.py`
- anything in `src/engine/` (rules, clock, possession, ai, sim) except adding read-only event hooks
- CPU defense decisions, assignments, contest/steal/block logic, difficulty scaling
- shot probabilities, foul logic, fatigue, substitution logic

You MAY change: rendering, camera, sprites, animation selection/timing, audio, UI/HUD visuals, assets.

**Animation follows the sim; the sim never waits on animation** (except dead-ball moments when the game
clock is stopped: free throws, made-basket celebration, timeout, subs). If an animation is longer than the
sim moment, speed up its playback or blend out early. Never delay a sim event to match an animation.

### Golden-master regression guard (do this FIRST)
1. Create `tools/golden.mjs`: run 5 fixed seeds x 4 matchups headless, hash each box score + play-by-play,
   write `tools/golden.json`.
2. Run it before any change to get the baseline. Re-run after every milestone.
3. Hashes must be identical. If they differ, you changed gameplay: revert or ask.
4. Also keep `tools/sim_check.mjs` passing.

If the current real-time layer mixes logic and drawing (likely in `entities.js` / `play.js`), **split it**:
logic stays untouched in behavior, drawing moves to a new `src/render/` layer. Prove it with the golden test.

---------------------------------------------------------------------------------------------------

## 1. Visual target

- **Internal resolution 640x360**, scaled by an integer factor (3x -> 1920x1080; 2x and 4x selectable) to
  the window. `image-rendering: pixelated`, no smoothing, **snap all draw positions to integer pixels**,
  no rotation or non-integer scaling of baked sprites (rotate joints, not bitmaps).
- Sprite cell **96x96**, feet anchored at (48, 84). Pixels per inch **0.71** (6'6" = ~55px, 7'3" = ~62px,
  6'0" = ~51px). Court shows roughly 75 ft of length at once.
- Palette: per character <= 24 colors, shared global palette for court/crowd/UI. 1px dark outline with
  selective inner lines, 2-tone shading, light from top-left, soft ground shadow ellipse.
- "Semi-high detail": visible face features at the pixel level (hair, beard, headband), jersey trim, number,
  shorts stripe, sneakers, wristbands, readable fingers on the ball hand. Not NBA Jam blocky, not hi-res.

## 2. Broadcast camera (2K-style)

- Side-on sideline camera, slightly elevated. Court drawn as a mild trapezoid (far sideline ~94% of near
  sideline width). Players **y-sorted**; no per-sprite scaling (perspective applies to the court only).
- World coords (x along court, y across) -> screen via one `project(x, y, z)` function. Jump height is a
  separate `z` that lifts the sprite and keeps the shadow on the floor.
- Camera follows ball + ball handler with smoothing and lead-ahead in the direction of play; clamps at
  baselines; pushes a bit tighter in half-court and wider on fast breaks. Smooth transitions, no jitter
  (round the final camera position to integers).
- Draw: hardwood with team court art (placeholder if no asset), baseline/sideline/3pt/key lines, center
  logo, hoops + backboards at both ends with a net that animates on makes, stanchions, scorer's table,
  both benches with seated players, 3 referees, crowd strip behind the far sideline, shot-clock boxes.
- Dead-ball camera moments: free throws (tighter), timeouts (huddles), inbounds, tip-off, end of quarter.

## 3. Sprite system (procedural pixel-art generator, not hand-drawn PNGs)

Why procedural: ~35 animations x 17 character variants x 2 kits would be thousands of frames. A rig lets us
generate all of them consistently and tweak looks in data.

- Build `src/render/rig.js`: a ~14-joint skeleton (head, neck, 2 shoulders, 2 elbows, 2 hands, hips,
  2 knees, 2 feet) with torso lean. Each animation = keyframes of joint angles + root offsets + z + ball
  anchor, interpolated and **rasterized into the 96x96 grid** (thick-line/capsule fills), then palette-mapped,
  shaded, outlined. Bake every frame once at load into an atlas (`OffscreenCanvas`), so drawing is blits.
- Layers: shadow, back arm, legs + shoes, shorts, torso/jersey (+trim + chest number), head (skin, hair,
  facial hair, headband), front arm, wristbands. Facing: draw for facing right; mirror for left.
- View: 3/4 toward-camera side view like the reference (chest number readable), 2 facings via mirroring.
- Customization comes from `data/appearance.json` (create it, see section 4): `skin_tone 1-6`, `hair`
  (buzz/short/fade/curly/afro/long/bald/bun), `facial_hair` (none/stubble/goatee/full), `headband`, `sleeve`,
  `wristbands`, `shoe_color`, `height_in`, `build` (lean/avg/strong/heavy -> body width), `mouthguard`.
- Home/away kits per team: body color, trim, number color, shorts. The game picks kits so the two teams
  never clash.
- **Stars**: top 4 per team get their own appearance entry (below). **Everyone else** uses one neutral
  generic look (same skin tone, short hair, avg build), in the correct jersey, scaled by position height
  class (G ~6'3", F ~6'8", C ~7'0") via the generator. No random faces on real players.
- Ball: separate 6-8px sprite with spin frames, bounce physics (z with gravity), shadow, arc on shots.

### Required: sprite viewer (`tools/sprite_viewer.html`)
A page that shows any character x any animation x kit, looping, with speed control, 1x/4x/8x zoom, frame
stepping, a grid, and a side-by-side of all 17 looks in the idle pose. Use it to iterate, and for the
user's review gate. If Playwright/Chromium is available locally, take screenshots of it and look at them
yourself each iteration; if not, ask the user for screenshots. Do not assume your sprites look good unseen.

## 4. Star players (top 4 per team) - first-pass appearance (estimates; keep editable)

Tone scale 1 (lightest) to 6 (darkest). Height in inches. These are estimates for likeness, not facts to
defend; the user will correct them in `data/appearance.json`.

| Team | Player | ht | build | tone | hair | face | extras |
|---|---|---|---|---|---|---|---|
| PHI | LeBron James | 81 | strong | 5 | short, receding | full beard | white headband, wristbands |
| PHI | Jaylen Brown | 78 | strong | 4 | short fade | light beard | |
| PHI | Joel Embiid | 84 | heavy | 5 | short/fade | full beard | |
| PHI | Tyrese Maxey | 74 | lean | 4 | short curly | stubble | |
| BOS | Jayson Tatum | 80 | avg | 4 | short fade | light stubble | |
| BOS | Paul George | 80 | lean | 4 | short | light beard | |
| BOS | Derrick White | 76 | lean | 4 | buzz | goatee | |
| BOS | Payton Pritchard | 73 | lean | 1 | short brown | short beard | |
| LAL | Luka Doncic | 80 | strong | 1 | dark brown, medium | full beard | |
| LAL | Austin Reaves | 77 | avg | 1 | short brown | light beard | |
| LAL | Walker Kessler | 85 | lean | 5 | short | none | |
| LAL | Matisse Thybulle | 77 | lean | 4 | short | none | |
| GSW | Stephen Curry | 74 | lean | 3 | short | none/stubble | mouthguard |
| GSW | Draymond Green | 78 | strong | 5 | shaved | goatee | |
| GSW | Brandin Podziemski | 76 | lean | 1 | short brown | none | |
| GSW | Yaxel Lendeborg | 81 | strong | 4 | short | light beard | |

Notes: Butler is injured and not playable, so he is not a star sprite. If a rating-based "top 4" would pick
different players, keep this list (it is picked for recognizability). Jersey numbers come from `players.json`.

## 5. Animation catalogue (all required; fps are defaults)

Each animation is keyframed joints; loops marked (L). "Trigger" = what drives it, from existing sim/real-time
state, never from new gameplay logic.

| Group | Animation | Frames | Trigger |
|---|---|---|---|
| Locomotion | idle (L), idle_ball triple-threat (L), idle_tired (L) | 4 | stopped; stamina low |
| | walk (L), jog (L), sprint (L, forward lean), backpedal (L), side_shuffle (L) | 6-8 | speed + facing vs velocity |
| Dribble | dribble_stand (L), dribble_jog (L), dribble_sprint (L), protect_ball (L) | 6-8 | ball handler state |
| Moves | crossover, between_legs, behind_back, spin, hesitation, step_back, euro_step | 6-10 | existing move/juke intents or direction-change events; AI handlers get them on direction changes |
| Passing | chest_pass, bounce_pass, overhead_pass, catch | 3-6 | pass events |
| Shooting | jumper (catch&shoot), pull_up, fadeaway, free_throw (with routine), floater, hook | 8-10 | shot events; **release frame = sim shot-resolve time** |
| Layups | layup_right, layup_left, finger_roll | 8 | drive finishes |
| Dunks | dunk_one_hand, dunk_two_hand, windmill, tomahawk, reverse, alley_oop_catch, rim_hang | 10-12 | dunk events; variant picked by `dunk` + `athleticism` attrs (read-only) |
| Defense | d_stance (L), d_slide (L), d_closeout, d_hands_up (contest), d_steal_swipe, d_block, box_out (L), deny (L) | 4-8 | defender state, contest, steal, block events |
| Rebounding | rebound_jump, rebound_grab, tip, loose_ball_dive | 6-8 | rebound events |
| Contact | foul_shove, hit_reaction, fall, get_up, hold_arm | 6-8 | foul events and contact |
| Reactions | celebrate, dejected, taunt, point_to_passer, clap | 6-8 | makes, misses, and-1, dunks |
| Bench/Refs | sit (L), stand_cheer (L), ref_run (L), ref_whistle, ref_foul_signal, ref_count(2/3), ref_out_of_bounds | 4-8 | dead ball, fouls, scoring |

Cross-cutting: animation blending (2-frame ease between states), speed-matched foot cadence, ball anchored to
the correct hand per animation, hand-off to ball sprite at release, footstep dust puffs on sprints, sweat
or glow optional, "on fire" effect when the existing hot-streak flag is set.

### Defense look (important, user request)
"I want to see opponents pressing up against ball handlers." Do this **visually only**:
- Defenders use d_stance/d_slide, stay low with arms out, mirror the man they guard, and play the
  contest/closeout/hands-up animations driven by the sim's existing contest state.
- Rendering may nudge a defender sprite up to ~6 px toward its assignment (pure cosmetic offset, clamped so
  it never crosses the offender's body) to read as "pressing". Sim positions and distances are untouched.
- If the sim keeps defenders loose, that is by design. **Do not move defenders in the sim to look tighter.**
  If you believe a gameplay-level change is needed, list it in your report and ask; do not make it.
- Body contact: when sim distance < guard radius, play a small hit_reaction/lean on both sprites.

## 6. Presentation extras (in scope)

- **HUD**: broadcast-style score bug (team abbreviations, scores, quarter, clock, shot clock, fouls,
  bonus indicator, timeouts), controlled-player arrow under feet, name + stamina bar tag, shot-timing
  meter, "CONTESTED"/"OPEN" tag, hot/fire icon, quick stat pop-up after scoring ("LeBron 22 PTS").
- **Referees** that move with play, signal fouls (with the fouler's number), whistle, count FT.
- **Substitutions**: walk-on/walk-off sprites at the scorer's table, jersey change on court.
- **Free throws**: dedicated camera, shooter routine, lane players lined up.
- **Timeouts/halftime**: huddle sprites, brief stats card.
- **Tip-off and intro**: team lineup card with starters' pixel portraits.
- **Pixel portraits** for pause/sub/box score: render each star's head+shoulders from the same rig/appearance
  data (procedural, free); generic bust for others.
- **Audio** (WebAudio, procedural, no files needed): dribble thump, sneaker squeaks, swish, rim clank,
  backboard, whistle, buzzer, crowd bed that swells on dunks/threes. Mute + volume setting.
- **Instant replay (stretch)**: because the sim is deterministic, record positions/events and replay the
  last dunk/3 from a tighter camera. Only after everything else is solid.
- **Settings**: pixel scale, camera zoom, crowd/audio toggles, show-controls overlay. Save in localStorage.

## 7. Higgsfield: where it is and is not used

Image generators cannot reliably produce consistent, animated, grid-aligned sprite sheets, so **do not use
Higgsfield for the player sprites or animation**. Use it (optional, credits are limited, ~110) for static art
only: 4 pixel-art team logos, 4 court-floor textures or one reference, a menu/title background, optional
star key-art. Check `balance`, get a price quote, show the user a 1-2 image style test before any batch,
download results into `assets/`, never hotlink. The game must run with zero Higgsfield assets (procedural
fallbacks for everything above).

## 8. Milestones (commit each; run golden + sim_check each time; stop at the starred gates)

- **G0 Audit + freeze**: read the code, report the current architecture and where real-time logic and
  rendering mix, create golden.mjs + baseline, split render from logic if needed. Report before coding art.
- **G1 Render foundation**: 640x360 pixel canvas, integer scaling, broadcast court + camera, project(),
  y-sorted shadows, hoops, bench/table placeholders, mannequin pixel sprites. Game plays exactly as before.
- **G2 Character generator + sprite viewer** *(GATE)*: rig, 17 looks, kits, idle/jog/sprint/dribble. Show
  screenshots; **stop for user review of the look** before building the other ~30 animations.
- **G3 Locomotion + dribble + defense stance/slide** wired through an animation state machine.
- **G4 Moves + passing** (crossover, between legs, behind back, spin, hesitation, step-back, euro-step).
- **G5 Shooting + layups + ball flight + net/rim feedback.** *(GATE: play a full quarter, user reviews feel)*
- **G6 Dunks, blocks, steals, rebounds, contact/fouls, reactions.**
- **G7 Presentation**: HUD, refs, benches, crowd, subs, free throws, timeouts, intro, portraits, audio.
- **G8 Polish**: perf (60 fps, baked atlas, no per-frame allocation), settings, bug bash, optional replay.

## 9. Definition of done

1. Full game playable at 60 fps with animated pixel-art players on a broadcast-style court.
2. Every animation in section 5 exists, is triggered by the right event, and looks right in the viewer.
3. The 16 star players are recognizable by build/hair/headband/jersey number and kit; everyone else is a
   generic body in the right jersey.
4. `golden.mjs` hashes identical to baseline and `sim_check.mjs` passes: gameplay is unchanged.
5. No console errors, works with zero downloaded assets, README updated with how to run and the viewer.

## 10. Working agreements

- Playwright (dev-only) is allowed for screenshots/verification if available; no other new dependencies
  without asking. No build step.
- Report after G0, G2, G5, G7, and at the end: what is done, what you saw in your screenshots, known issues.
- When unsure, pick the simplest option that keeps the game playable and tell the user.

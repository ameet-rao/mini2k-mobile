# Prompts for the graphics upgrade (paste in order)

## 1. Kickoff (G0 -> G2)

```
Read docs/GRAPHICS_BRIEFING.md fully, plus CLAUDE.md and docs/BRIEFING.md, then look at
docs/ref/pixel_style_ref.png for the art style. We are upgrading the presentation of the existing game:
animated pixel-art players, a 2K-style broadcast camera, and game-day presentation.

HARD RULE: gameplay must not change. Do not touch data/*.json, ratings, src/engine/*, CPU defense logic,
or difficulty. Presentation only.

Do G0 first: audit the repo, tell me where logic and rendering are mixed, build tools/golden.mjs and record
the baseline. Then do G1 and G2 (render foundation, procedural character generator, sprite viewer with the
16 star looks + generic players and the first animations). Take screenshots of the sprite viewer and look at
them yourself (use Playwright dev-only if available). Stop after G2 and show me what the characters look
like so I can approve the style before you build the rest.
```

## 2. After you approve the look (G3 -> G5)

```
Look approved. Continue with G3, G4, G5 from docs/GRAPHICS_BRIEFING.md: locomotion, dribble, defense
stance/slide, moves, passing, shooting, layups, ball flight, net and rim feedback. Re-run golden.mjs and
sim_check.mjs after each milestone; hashes must match baseline. Stop after G5 and tell me how to play a
quarter and what to look at.
```

## 3. After you've played it (G6 -> G8)

```
Continue with G6 (dunks, blocks, steals, rebounds, fouls, reactions), G7 (presentation: HUD, refs, benches,
crowd, subs, free throws, timeouts, intro, pixel portraits, audio) and G8 (polish, performance). Keep the
golden test green. Give me a final report with known issues.
```

## Useful follow-ups

- "Star X doesn't look right: edit data/appearance.json (hair/build/tone/headband), rebuild, show me the viewer."
- "The dunk looks stiff: tune keyframes for dunk_two_hand and show me the frame strip at 8x."
- "Make the camera tighter in half-court" / "Make sprites a bit bigger" (change internal res or px per inch).
- "Make defenders look more aggressive without changing the sim": visual offsets and animations only.

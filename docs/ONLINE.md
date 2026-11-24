# Mini2K online (two players, WebRTC)

File: `dist/mini2k-online.html` (build with `node tools/build_standalone.mjs --online`). It is the full
game plus a **Play a friend online** button. Single-player and CPU demo play exactly as before
(golden check PASS, and one-player games with the same key presses produce byte-identical event logs).

## How to play
1. Both of you open `mini2k-online.html` (double-click it) and press **Play a friend online**.
2. Pick your own team. One of you presses **Create room** and reads out the 6-letter code.
   That person is the home team and picks quarter length and meter difficulty.
3. The other types the code and presses **Join room**. When both screens say Connected, the room
   creator presses **Tip off**.
4. Can't find the room (the room service is blocked)? Switch "Connect through" to
   **Manual codes**: the creator copies a code to the friend (chat, email), the friend pastes it and sends one back.
5. School wifi: if it says it could not connect, the room creator adds a relay in **Network settings**
   (see below). Only the room creator needs it; the joiner receives it automatically.

Controls are the same as single player. **P** opens the coach menu but does not stop an online game
(there is a **Pause both screens** button in it). **T** or the coach menu's timeout, and subs, are
requests: they reach the game and happen at the next dead ball on both screens at once.

## How it works
- **Host is the source of truth.** The room creator's screen runs the game. Both screens run the same
  deterministic engine (seeded random numbers, fixed 60 Hz steps, no clock reads in the engine), so the
  host sends only the inputs used for each step (about 3 bytes a step), not the whole game. The guest's
  copy replays them and stays identical.
- **One player per team.** `LiveGame` now takes `user: 'both'`: each human side has its own context
  (`uc.home`, `uc.away`: controlled player, sub and timeout requests). The host only lets the guest's
  buttons drive the away team, forces every guest request to the away team, and checks sub requests
  against the away roster.
- **Timeouts and subs** travel as requests. The host puts each into the next step's frame, both copies
  apply it at that same step, and the engine makes it at its next safe moment (subs at a dead ball,
  timeout when that team has the ball), as in single player.
- **Fair timing over the network.** Each guest input says which step its screen was showing. The host
  passes the gap as `lag` with that input, and the shot meter, free-throw meter and rebound jump are
  judged against what the guest saw (capped at 0.35 s). Tested at 240 ms round trip: a guest releasing
  at the sweet spot on screen got 65 Perfect and 18 Good, no Late.
- **Auto-correct only when needed.** The guest keeps a small cushion of frames (50 ms, grows on a
  jittery link). No lag: plays at normal speed, nothing is corrected. Small gap: plays up to 25% faster
  until back in step (smooth). Over half a second behind: jumps straight to the present (snap).
  Over 8 seconds behind, a fingerprint mismatch, or a rejoin: loads a full snapshot of the host's game.
- **Short history / snapshots.** `src/net/snapshot.js` saves the whole game (shared references and all)
  and restores it into the existing objects, so the players on screen don't reset. The host sends a
  fingerprint of the game every second; if the guest's copy ever differs (different browsers can round
  some maths differently), it loads the host's snapshot.
- **Disconnects.** If the guest drops, the host's game pauses and the guest can press Rejoin (same code);
  the host sends a snapshot and play continues.

## Connections and cost
- Signaling (finding each other): ntfy.sh, a free public message relay, no account. Only the offer and
  answer go through it. Manual codes need no server at all.
- Direct route: free public STUN servers (Google, Cloudflare).
- Relay for blocked networks (TURN): Metered's free plan gives 20 GB a month with a free signup; paste the
  "credentials" link from its dashboard into Network settings. One game uses roughly 30 to 60 MB through
  a relay, so the free plan covers hundreds of games. Any other TURN server works too.

## Checks
- `node tools/net_check.mjs [latencyMs] [jitterMs] [quarterMin]` plays full online games over a fake
  network with wifi dropouts and one forced drift, and fails unless both screens end identical.
- `node tools/golden.mjs` must stay PASS.

## Code map
`src/net/session.js` (netcode), `src/net/peer.js` (WebRTC, room codes, manual codes, TURN settings),
`src/net/snapshot.js` (save/restore, fingerprint), lobby in `src/main.js` (online section) and `src/index.html`.

## Shot timing for the guest (v12)
The guest's screen counts how long Space is held (in 1/60 s steps) and sends that count with the
release, inside the normal input stream. The host puts it in the frame, so both screens judge the
same release with the same number. The guest's meter is drawn from its own count, so it fills with
no delay. An earlier version let the guest decide its shot result and send it separately; that made
the two screens disagree on every guest shot, which caused a resync (fast-forward) and then a freeze.

## Relay (TURN) on blocked networks (v13)
- The relay settings are read when you press Create room or Join, so typing them is enough (Save is optional).
- Either computer can enter them: the guest's go to the host with the join request, and the host's go to
  the guest with the offer, so both screens use every relay either side entered.
- An address without `turn:` is accepted (`relay.example.com:3478`); each `turn:` address also gets a TCP
  version, since school wifi often blocks UDP. Missing username or password, or an invalid address, is shown.
- Each side checks that its relay server gave a relay candidate; if not, it says the login did not work.
- If the direct connection is not up within 9 s and a relay is set, the guest asks again and both sides
  reconnect with relay only (`iceTransportPolicy: 'relay'`).
- Tested with a local TURN server: relay set on guest only, host only, both; direct blocked; first try
  blocked entirely (fallback); wrong password (clear message).
- Note: the relay login travels inside the room messages (public ntfy.sh topic named by the room code).
  Use a free relay account, not a password used anywhere else.

## Multiplayer: 2v2 and 3v3

3v3 works the same way with three people per team: PG and SG, SF, PF and C. The room creator picks the mode in the lobby. The section below says 2v2 but applies to both.

## 2v2 (up to four people)

"Play 2v2 Online" on the main menu. One person creates a room, up to three join with the code (it
needs the Mini2K server; "This computer: tabs" is for testing). In the lobby everyone picks a spot:
on each team one person runs the PG and C, the other the SG, SF and PF. An open spot is played by the
CPU, and anyone without a spot watches. Someone on a team (or the room creator) picks that team.

- The room creator's screen runs the game, as in the two-player mode. Every message goes through one
  WebSocket room on the server (`HubLink`), so it works on school wifi too. Lag for the other three is
  their trip to the server and back to the host's screen, plus a 50 ms cushion; shots are still timed
  on each person's own screen.
- Off the ball on offense, your player runs the CPU's cuts unless you hold a direction; Q switches to
  your other player. On defense Q switches between your own defenders.
- Someone who drops out: their players stand still and the host's badge says WAITING FOR <name>.
  Reopening the page and joining with the same code and the same name puts them back in their spot.
- Check: `node tools/net4_check.mjs` (fake room with latency, jitter and dropouts, every screen must
  end with the host's game and nobody may control a position that isn't theirs).

## Lag fixes for the guest (v22)

**Local shot meter.** The guest's own screen runs its shot and free-throw meter on its own clock and
decides the result (green, slightly early, very early, very late, or a pump fake) the moment Space comes
up, against the green window it is showing. The result rides to the host with that release, inside the
normal input stream (`hold` = steps held * 8 + result code, `RES` in live.js), so every screen applies the
same result at the same step. Lag can delay the shot, never change it: a green on the guest's screen is a
green. The host no longer lets go of a remote player's meter itself (it waits up to 1.5 s past the top for
the release). If the host's game has already moved on (a steal, a whistle, the shot clock), the release is
ignored, because the host's game is still the truth. After letting a shot go, the guest can't start a
second meter for that same shot while its screen catches up.

**Prediction of your own player.** The guest draws its own player where its own buttons have already
taken him, instead of a round trip later. The guest numbers its button samples (the number rides along
once a second, the channel keeps order); every frame message from the host says the last sample the game
has used. The guest replays the samples still in flight on top of the host's position, with the engine's
own speed, acceleration, body blocking and court edges (`Session.predict`). When the host's game
disagrees (a bump, a steal, a screen), the drawn player glides back over about 1/30 s; over 8 feet off, it
jumps. Display only: nothing touches the game state, so both screens still end identical. Not predicted:
dribble moves, the shot meter and pump-fake pivot, passes, and catching (the host's game shows those).

Checks: `net_check.mjs`, `net4_check.mjs`, `golden.mjs` all PASS. In a 150 ms +/- 60 ms fake network, the
drawn player is on average 0.6 ft from where the host's game puts him (2.6 ft without prediction), and
every guest release the host applied gave exactly the result the guest's screen showed.

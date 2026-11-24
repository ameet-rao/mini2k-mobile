# Mini2K Mobile

Phone version of Mini2K (basketball, pixel-art broadcast view). Play it at **https://ameet-rao.github.io/mini2k-mobile/** — hold the phone sideways.

Modes: Quick game vs CPU, StreetBall 3on3 vs CPU, Watch CPU vs CPU. No Franchise, no online play.

Controls: left thumb anywhere on the left half = joystick (drag past the ring to sprint). Right buttons change with possession: SHOOT/BLOCK (hold, let go to shoot; quick tap = pump fake), PASS/STEAL, LOB/SWITCH, PICK/DOUBLE, MOVE, SPIN, SPRINT. Top: II pause, TO timeout.

`index.html` is the one-file build. Edit `src/`, then run `node tools/build_standalone.mjs` and copy `dist/mini2k-mobile.html` over `index.html`.

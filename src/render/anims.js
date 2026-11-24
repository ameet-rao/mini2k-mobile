// Animation catalogue: every animation is a list of keyframes [timeFraction, partialPose] over
// BASE_POSE (see rig.js for the angle convention). Loops wrap; one-shots hold the last key.
//   dur   seconds at normal speed          loop  true for cycles
//   ball  where the ball sits: 'F'/'B' hand, '2' both hands, 'drib' bouncing under the front hand,
//         null = the animation has no ball (the scene draws it in flight)
//   rel   for shots/passes: fraction of the animation at which the ball leaves the hand
import { BASE_POSE } from './rig.js';

const A = {};
const def = (name, dur, loop, keys, extra = {}) => {
  // A planted back leg with a bent knee used to kick out behind the body. For grounded poses we
  // hand that leg to the rig's IK instead (foot on the floor behind the hips, knee forward).
  const stride = loop && keys.length >= 6;      // run/walk cycles keep their free-swinging legs
  if (!stride) for (const [, p] of keys) {
    if ((p.lift ?? 0) <= 1 && p.rootY == null && p.lB && p.lB[0] < -10 && p.lB[0] - p.lB[1] < -44) p.ikB = Math.sin(-p.lB[0] * Math.PI / 180) * 1.5 + 0.25;
  }
  A[name] = { name, dur, loop, keys, ball: null, ...extra };
};

/** Leg/arm cycle for walking and running. */
function cycle({ stride, knee, arm = 0, elbow = 20, lean = 6, bounce = 0, back = false, armF = null, armB = null, n = 8 }) {
  const keys = [];
  for (let i = 0; i < n; i++) {
    const p = (i / n) * Math.PI * 2, s = Math.sin(p), c = Math.cos(p);
    const sgn = back ? -1 : 1;
    keys.push([i / n, {
      lean,
      lF: [stride * s, 8 + knee * Math.max(0, c * sgn)],
      lB: [-stride * s, 8 + knee * Math.max(0, -c * sgn)],
      aF: armF ?? [-arm * s, elbow],
      aB: armB ?? [arm * s, elbow],
      lift: bounce * Math.abs(Math.sin(p)),
    }]);
  }
  return keys;
}

// ------------------------------------------------------------------ locomotion
def('idle', 1.6, true, [[0, {}], [0.5, { lF: [9, 10], lB: [-7, 10], aF: [-2, 16], aB: [-9, 15] }]]);
def('idle_ball', 1.4, true, [
  [0, { lean: 22, aF: [38, 72], aB: [48, 62], lF: [30, 45], lB: [-6, 34] }],
  [0.5, { lean: 24, aF: [34, 76], aB: [44, 66], lF: [32, 48], lB: [-6, 36] }],
], { ball: '2' });
def('idle_tired', 1.8, true, [
  [0, { lean: 42, head: 12, aF: [-4, 8], aB: [-8, 8], lF: [16, 24], lB: [-4, 22] }],
  [0.5, { lean: 46, head: 16, aF: [-6, 8], aB: [-10, 8], lF: [16, 28], lB: [-4, 26] }],
]);
def('walk', 0.9, true, cycle({ stride: 18, knee: 22, arm: 14, elbow: 14, lean: 5 }));
def('jog', 0.62, true, cycle({ stride: 32, knee: 48, arm: 30, elbow: 70, lean: 11, bounce: 1.5 }));
def('sprint', 0.46, true, cycle({ stride: 52, knee: 78, arm: 55, elbow: 92, lean: 25, bounce: 2 }));
def('backpedal', 0.6, true, cycle({ stride: 22, knee: 30, arm: 10, elbow: 40, lean: -7, back: true }));
def('side_shuffle', 0.5, true, [
  [0, { lean: 16, lF: [38, 24], lB: [-36, 24], aF: [70, 20], aB: [-50, -25] }],
  [0.5, { lean: 16, lF: [14, 22], lB: [-12, 22], aF: [62, 28], aB: [-42, -30], lift: 1 }],
]);

// ------------------------------------------------------------------ dribble
def('dribble_stand', 0.56, true, [
  [0, { lean: 16, aF: [26, 34], aB: [-22, 34], lF: [22, 30], lB: [-10, 26] }],
  [0.5, { lean: 16, aF: [34, 58], aB: [-22, 34], lF: [22, 32], lB: [-10, 28] }],
], { ball: 'drib' });
def('dribble_jog', 0.6, true, cycle({ stride: 30, knee: 44, arm: 26, elbow: 60, lean: 14, bounce: 1.2, armF: [34, 40] }), { ball: 'drib' });
def('dribble_sprint', 0.46, true, cycle({ stride: 50, knee: 74, arm: 50, elbow: 88, lean: 26, bounce: 2, armF: [52, 26] }), { ball: 'drib' });
def('protect_ball', 0.7, true, [
  [0, { lean: 26, aF: [-26, 30], aB: [82, 24], lF: [34, 40], lB: [-22, 36] }],
  [0.5, { lean: 28, aF: [-30, 50], aB: [86, 18], lF: [34, 44], lB: [-22, 40] }],
], { ball: 'drib' });

// ------------------------------------------------------------------ post play (back to the basket: drawn facing away from the hoop)
def('post_up', 0.7, true, [
  [0, { lean: -14, head: 10, aF: [44, 40], aB: [-70, -30], lF: [30, 44], lB: [-34, 50] }],
  [0.5, { lean: -18, head: 10, aF: [50, 60], aB: [-76, -34], lF: [26, 48], lB: [-40, 54], dx: -1 }],
], { ball: 'drib' });
def('post_hold', 1.0, true, [
  [0, { lean: -10, head: 8, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2' }],
  [0.5, { lean: -13, head: 8, aF: [74, 84], aB: [80, 76], lF: [30, 46], lB: [-36, 50], ball: '2' }],
], { ball: '2' });
def('drop_step', 0.5, false, [
  [0, { lean: -12, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2' }],
  [0.4, { lean: -4, aF: [80, 90], aB: [86, 82], lF: [-30, 30], lB: [-50, 20], dx: -3, ball: '2', flip: true }],
  [1, { lean: 16, aF: [90, 80], aB: [96, 72], lF: [44, 50], lB: [-20, 30], dx: -5, ball: '2', flip: true }],
]);

// ------------------------------------------------------------------ dribble moves (one-shots)
def('crossover', 0.42, false, [
  [0, { lean: 20, aF: [40, 30], aB: [8, 28], lF: [36, 26], lB: [-26, 26], ball: 'F' }],
  [0.45, { lean: 24, aF: [18, 20], aB: [30, 26], lF: [40, 40], lB: [-30, 30], ball: 'F' }],
  [0.6, { lean: 22, aF: [6, 22], aB: [46, 30], lF: [20, 30], lB: [-34, 26], ball: 'B' }],
  [1, { lean: 18, aF: [-10, 30], aB: [40, 40], lF: [10, 24], lB: [-20, 24], ball: 'B' }],
]);
def('between_legs', 0.46, false, [
  [0, { lean: 24, aF: [30, 20], aB: [-14, 14], lF: [52, 52], lB: [-36, 30], ball: 'F' }],
  [0.5, { lean: 30, aF: [14, 8], aB: [-6, 8], lF: [54, 56], lB: [-38, 32], ball: 'F' }],
  [0.62, { lean: 28, aF: [10, 14], aB: [-18, 12], lF: [52, 52], lB: [-36, 30], ball: 'B' }],
  [1, { lean: 20, aF: [20, 30], aB: [-26, 30], lF: [30, 34], lB: [-20, 28], ball: 'B' }],
]);
def('behind_back', 0.44, false, [
  [0, { lean: 10, aF: [10, 20], aB: [-10, 20], lF: [24, 24], lB: [-16, 22], ball: 'F' }],
  [0.4, { lean: 6, aF: [-48, -18], aB: [-30, 10], lF: [26, 26], lB: [-18, 24], ball: 'F' }],
  [0.6, { lean: 6, aF: [-20, 10], aB: [-50, -10], lF: [28, 26], lB: [-18, 24], ball: 'B' }],
  [1, { lean: 14, aF: [16, 30], aB: [20, 40], lF: [20, 24], lB: [-12, 22], ball: 'B' }],
]);
def('spin', 0.5, false, [
  [0, { lean: 16, aF: [30, 100], aB: [34, 90], lF: [30, 30], lB: [-20, 30], ball: '2' }],
  [0.3, { lean: 10, aF: [24, 110], aB: [28, 100], lF: [14, 34], lB: [-8, 34], ball: '2', flip: true }],
  [0.7, { lean: 10, aF: [24, 110], aB: [28, 100], lF: [-10, 34], lB: [16, 34], ball: '2', flip: true }],
  [1, { lean: 18, aF: [36, 40], aB: [-10, 30], lF: [30, 30], lB: [-20, 28], ball: 'F' }],
]);
def('hesitation', 0.5, false, [
  [0, { lean: 18, aF: [34, 40], aB: [-20, 30], lF: [26, 30], lB: [-14, 28], ball: 'F' }],
  [0.4, { lean: 0, head: -8, aF: [30, 74], aB: [-10, 40], lF: [10, 8], lB: [-6, 8], lift: 1, ball: 'F' }],
  [0.7, { lean: 2, head: -6, aF: [30, 70], aB: [-10, 40], lF: [10, 10], lB: [-6, 10], ball: 'F' }],
  [1, { lean: 24, aF: [44, 30], aB: [-30, 40], lF: [40, 40], lB: [-30, 30], ball: 'F' }],
]);
def('step_back', 0.46, false, [
  [0, { lean: 14, aF: [30, 60], aB: [36, 56], lF: [46, 12], lB: [-10, 40], ball: '2' }],
  [0.5, { lean: -10, aF: [34, 80], aB: [40, 74], lF: [50, 6], lB: [-30, 44], lift: 3, dx: -4, ball: '2' }],
  [1, { lean: -4, aF: [44, 86], aB: [50, 78], lF: [12, 26], lB: [-12, 26], dx: -7, ball: '2' }],
]);
def('euro_step', 0.52, false, [
  [0, { lean: 18, aF: [70, 80], aB: [76, 70], lF: [58, 30], lB: [-30, 20], ball: '2' }],
  [0.45, { lean: -6, aF: [110, 70], aB: [114, 60], lF: [10, 30], lB: [-50, 40], lift: 2, ball: '2' }],
  [1, { lean: 14, aF: [130, 60], aB: [134, 50], lF: [-20, 20], lB: [56, 60], lift: 4, ball: '2' }],
]);

// ------------------------------------------------------------------ passing
def('chest_pass', 0.34, false, [
  [0, { lean: 10, aF: [56, 86], aB: [62, 80], lF: [20, 16], lB: [-12, 16], ball: '2' }],
  [0.45, { lean: 16, aF: [84, 8], aB: [88, 6], lF: [34, 20], lB: [-20, 12], ball: '2' }],
  [1, { lean: 14, aF: [80, 0], aB: [84, 0], lF: [34, 20], lB: [-20, 12] }],
], { rel: 0.45 });
def('bounce_pass', 0.36, false, [
  [0, { lean: 16, aF: [50, 80], aB: [56, 74], lF: [22, 20], lB: [-12, 18], ball: '2' }],
  [0.45, { lean: 32, aF: [56, 6], aB: [60, 4], lF: [40, 30], lB: [-22, 14], ball: '2' }],
  [1, { lean: 28, aF: [54, 0], aB: [58, 0], lF: [40, 30], lB: [-22, 14] }],
], { rel: 0.45 });
def('overhead_pass', 0.36, false, [
  [0, { lean: -4, aF: [166, 30], aB: [170, 24], lF: [10, 8], lB: [-8, 8], ball: '2' }],
  [0.5, { lean: 10, aF: [128, 6], aB: [132, 4], lF: [26, 14], lB: [-14, 10], ball: '2' }],
  [1, { lean: 12, aF: [110, 0], aB: [114, 0], lF: [26, 14], lB: [-14, 10] }],
], { rel: 0.5 });
def('catch', 0.3, false, [
  [0, { lean: 8, aF: [82, 10], aB: [86, 8], lF: [16, 14], lB: [-10, 14] }],
  [0.5, { lean: 12, aF: [66, 50], aB: [70, 44], lF: [20, 20], lB: [-10, 18], ball: '2' }],
  [1, { lean: 20, aF: [42, 74], aB: [50, 64], lF: [28, 40], lB: [-6, 32], ball: '2' }],
]);

// ------------------------------------------------------------------ shooting (rel = release point)
const jumper = (leanSet, leanAir, kick, drift) => [
  [0, { lean: 20, aF: [40, 82], aB: [50, 72], lF: [26, 46], lB: [-8, 40], ball: '2' }],
  [0.3, { lean: leanSet + 8, aF: [70, 96], aB: [80, 84], lF: [24, 50], lB: [-8, 44], ball: '2' }],
  [0.48, { lean: leanSet, aF: [124, 74], aB: [130, 58], lF: [10, 12], lB: [-6, 12], lift: 4, dx: drift * 0.4, ball: '2' }],
  [0.6, { lean: leanAir, head: -6, aF: [158, 12], aB: [134, 44], lF: [kick, 8], lB: [-4, 14], lift: 10, dx: drift * 0.7, ball: 'F' }],
  [0.75, { lean: leanAir, head: -6, aF: [152, -34], aB: [120, 40], lF: [kick, 10], lB: [-4, 16], lift: 9, dx: drift }],
  [1, { lean: 6, aF: [140, -30], aB: [60, 40], lF: [14, 24], lB: [-8, 22], lift: 0, dx: drift }],
];
def('jumper', 0.95, false, jumper(2, -2, 6, 0), { rel: 0.6 });
def('pull_up', 0.9, false, jumper(-2, -6, 10, 2), { rel: 0.6 });
def('fadeaway', 1.0, false, jumper(-10, -24, 38, -6), { rel: 0.6 });
def('free_throw', 2.2, false, [
  [0, { lean: 14, aF: [30, 40], aB: [-10, 30], lF: [10, 14], lB: [-8, 14], ball: 'drib' }],
  [0.3, { lean: 16, aF: [34, 52], aB: [-10, 30], lF: [10, 16], lB: [-8, 16], ball: 'drib' }],
  [0.42, { lean: 18, aF: [44, 84], aB: [52, 74], lF: [18, 36], lB: [-8, 32], ball: '2' }],
  [0.58, { lean: 4, aF: [122, 76], aB: [128, 60], lF: [14, 30], lB: [-8, 26], ball: '2' }],
  [0.68, { lean: 0, head: -5, aF: [158, 12], aB: [134, 44], lF: [8, 6], lB: [-6, 6], lift: 1, ball: 'F' }],
  [0.8, { lean: 0, head: -5, aF: [152, -34], aB: [120, 40], lF: [8, 6], lB: [-6, 6], lift: 1 }],
  [1, { lean: 2, aF: [146, -34], aB: [70, 40], lF: [8, 6], lB: [-6, 6] }],
], { rel: 0.68 });
def('floater', 0.7, false, [
  [0, { lean: 20, aF: [60, 80], aB: [66, 70], lF: [40, 30], lB: [-30, 20], ball: '2' }],
  [0.4, { lean: 8, aF: [130, 50], aB: [70, 50], lF: [10, 10], lB: [40, 70], lift: 6, ball: 'F' }],
  [0.55, { lean: 4, aF: [160, 6], aB: [60, 50], lF: [4, 8], lB: [50, 80], lift: 9, ball: 'F' }],
  [1, { lean: 8, aF: [150, -20], aB: [40, 40], lF: [10, 20], lB: [-8, 20] }],
], { rel: 0.55 });
def('hook', 0.8, false, [
  [0, { lean: 16, aF: [20, 60], aB: [70, 40], lF: [30, 34], lB: [-16, 30], ball: 'F' }],
  [0.4, { lean: -4, aF: [-60, 10], aB: [84, 30], lF: [8, 10], lB: [30, 50], lift: 4, ball: 'F' }],
  [0.58, { lean: -10, aF: [-176, 0], aB: [88, 24], lF: [4, 6], lB: [36, 60], lift: 9, ball: 'F' }],
  [0.75, { lean: -6, aF: [150, -20], aB: [80, 24], lF: [4, 8], lB: [20, 40], lift: 7 }],
  [1, { lean: 6, aF: [120, -10], aB: [40, 30], lF: [10, 20], lB: [-8, 20] }],
], { rel: 0.58 });

// ------------------------------------------------------------------ layups
const layup = (hand) => [
  [0, { lean: 22, aF: [60, 80], aB: [66, 72], lF: [52, 30], lB: [-34, 24], ball: '2' }],
  [0.35, { lean: 12, aF: hand === 'F' ? [120, 60] : [70, 60], aB: hand === 'F' ? [70, 60] : [124, 54], lF: [-12, 12], lB: [66, 84], lift: 7, ball: hand }],
  [0.6, { lean: 6, aF: hand === 'F' ? [168, 6] : [60, 50], aB: hand === 'F' ? [56, 50] : [170, 4], lF: [-16, 10], lB: [74, 92], lift: 13, ball: hand }],
  [0.78, { lean: 4, aF: hand === 'F' ? [160, -20] : [50, 40], aB: hand === 'F' ? [50, 40] : [162, -16], lF: [-10, 10], lB: [50, 60], lift: 10 }],
  [1, { lean: 10, aF: [60, 30], aB: [20, 30], lF: [16, 28], lB: [-10, 24] }],
];
def('layup_right', 0.75, false, layup('F'), { rel: 0.6 });
def('layup_left', 0.75, false, layup('B'), { rel: 0.6 });
def('finger_roll', 0.8, false, [
  [0, { lean: 22, aF: [50, 70], aB: [60, 64], lF: [52, 30], lB: [-34, 24], ball: '2' }],
  [0.35, { lean: 10, aF: [96, 30], aB: [60, 60], lF: [-12, 12], lB: [66, 84], lift: 8, ball: 'F' }],
  [0.6, { lean: 2, aF: [150, -8], aB: [50, 50], lF: [-16, 10], lB: [70, 90], lift: 14, ball: 'F' }],
  [0.78, { lean: 2, aF: [166, -30], aB: [44, 40], lF: [-10, 10], lB: [44, 56], lift: 11 }],
  [1, { lean: 10, aF: [70, 20], aB: [20, 30], lF: [16, 28], lB: [-10, 24] }],
], { rel: 0.6 });

// ------------------------------------------------------------------ dunks (rel = the slam)
def('dunk_one_hand', 0.85, false, [
  [0, { lean: 24, aF: [50, 70], aB: [60, 64], lF: [54, 34], lB: [-36, 26], ball: '2' }],
  [0.3, { lean: 14, aF: [130, 50], aB: [30, 50], lF: [20, 50], lB: [50, 80], lift: 10, ball: 'F' }],
  [0.55, { lean: 2, aF: [178, 8], aB: [-20, 40], lF: [30, 70], lB: [10, 60], lift: 19, ball: 'F' }],
  [0.68, { lean: 12, aF: [118, 6], aB: [-30, 30], lF: [34, 74], lB: [14, 64], lift: 18, ball: 'F' }],
  [0.85, { lean: 8, aF: [150, 10], aB: [-10, 30], lF: [20, 40], lB: [0, 40], lift: 10 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
], { rel: 0.68 });
def('dunk_two_hand', 0.85, false, [
  [0, { lean: 24, aF: [50, 70], aB: [60, 64], lF: [54, 34], lB: [-36, 26], ball: '2' }],
  [0.3, { lean: 10, aF: [140, 60], aB: [146, 52], lF: [30, 60], lB: [20, 60], lift: 10, ball: '2' }],
  [0.55, { lean: -6, aF: [186, 30], aB: [190, 24], lF: [40, 80], lB: [30, 80], lift: 19, ball: '2' }],
  [0.68, { lean: 16, aF: [120, 4], aB: [124, 2], lF: [44, 84], lB: [34, 84], lift: 18, ball: '2' }],
  [0.85, { lean: 8, aF: [156, 8], aB: [160, 6], lF: [20, 40], lB: [4, 40], lift: 11 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
], { rel: 0.68 });
def('windmill', 0.95, false, [
  [0, { lean: 24, aF: [40, 60], aB: [50, 60], lF: [54, 34], lB: [-36, 26], ball: '2' }],
  [0.25, { lean: 10, aF: [-40, 10], aB: [70, 40], lF: [30, 56], lB: [40, 70], lift: 10, ball: 'F' }],
  [0.42, { lean: 2, aF: [-130, 0], aB: [60, 40], lF: [36, 70], lB: [20, 70], lift: 17, ball: 'F' }],
  [0.56, { lean: -4, aF: [-200, 0], aB: [40, 40], lF: [40, 80], lB: [20, 76], lift: 20, ball: 'F' }],
  [0.68, { lean: 12, aF: [-244, 6], aB: [-20, 30], lF: [36, 76], lB: [16, 66], lift: 18, ball: 'F' }],
  [0.85, { lean: 8, aF: [150, 10], aB: [-10, 30], lF: [20, 40], lB: [0, 40], lift: 10 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
], { rel: 0.68 });
def('tomahawk', 0.9, false, [
  [0, { lean: 24, aF: [50, 70], aB: [60, 64], lF: [54, 34], lB: [-36, 26], ball: '2' }],
  [0.3, { lean: 8, aF: [150, 70], aB: [20, 50], lF: [24, 50], lB: [50, 84], lift: 11, ball: 'F' }],
  [0.54, { lean: -14, aF: [214, 80], aB: [-30, 40], lF: [44, 90], lB: [10, 60], lift: 20, ball: 'F' }],
  [0.68, { lean: 18, aF: [116, 4], aB: [-40, 30], lF: [36, 76], lB: [14, 64], lift: 18, ball: 'F' }],
  [0.85, { lean: 8, aF: [150, 10], aB: [-10, 30], lF: [20, 40], lB: [0, 40], lift: 10 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
], { rel: 0.68 });
def('reverse', 0.9, false, [
  [0, { lean: 24, aF: [50, 70], aB: [60, 64], lF: [54, 34], lB: [-36, 26], ball: '2' }],
  [0.3, { lean: 6, aF: [140, 60], aB: [146, 52], lF: [30, 60], lB: [20, 60], lift: 11, ball: '2', flip: true }],
  [0.55, { lean: -16, aF: [200, 20], aB: [204, 14], lF: [50, 70], lB: [36, 70], lift: 19, ball: '2', flip: true }],
  [0.68, { lean: -22, aF: [232, 4], aB: [236, 0], lF: [56, 70], lB: [40, 70], lift: 18, ball: '2', flip: true }],
  [0.85, { lean: -6, aF: [190, 10], aB: [194, 6], lF: [24, 40], lB: [8, 40], lift: 10, flip: true }],
  [1, { lean: 8, aF: [40, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30], flip: true }],
], { rel: 0.68 });
def('alley_oop_catch', 0.85, false, [
  [0, { lean: 20, aF: [80, 30], aB: [86, 24], lF: [54, 34], lB: [-36, 26] }],
  [0.3, { lean: 4, aF: [170, 10], aB: [174, 6], lF: [20, 40], lB: [36, 70], lift: 12 }],
  [0.5, { lean: -4, aF: [182, 30], aB: [186, 24], lF: [36, 70], lB: [24, 70], lift: 19, ball: '2' }],
  [0.68, { lean: 16, aF: [120, 4], aB: [124, 2], lF: [44, 84], lB: [34, 84], lift: 18, ball: '2' }],
  [0.85, { lean: 8, aF: [156, 8], aB: [160, 6], lF: [20, 40], lB: [4, 40], lift: 11 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
], { rel: 0.68 });
def('rim_hang', 0.9, true, [
  [0, { lean: 4, aF: [176, 4], aB: [180, 0], lF: [22, 30], lB: [8, 26], lift: 0, rootY: 44 }],
  [0.5, { lean: -8, aF: [184, -4], aB: [188, -8], lF: [-6, 30], lB: [-18, 26], lift: 0, rootY: 44 }],
]);

// ------------------------------------------------------------------ defense
def('d_stance', 0.9, true, [
  [0, { lean: 22, aF: [74, 16], aB: [-52, -22], lF: [34, 46], lB: [-32, 46] }],
  [0.5, { lean: 24, aF: [70, 22], aB: [-48, -28], lF: [34, 50], lB: [-32, 50] }],
]);
def('d_slide', 0.42, true, [
  [0, { lean: 22, aF: [76, 14], aB: [-54, -20], lF: [44, 40], lB: [-40, 40] }],
  [0.5, { lean: 22, aF: [70, 22], aB: [-48, -28], lF: [20, 44], lB: [-16, 44], lift: 1 }],
]);
def('d_closeout', 0.4, true, cycle({ stride: 24, knee: 36, lean: 12, bounce: 1, armF: [162, 12], armB: [-20, 40], n: 6 }));
def('d_hands_up', 0.7, true, [
  [0, { lean: 6, aF: [172, 6], aB: [164, 8], lF: [20, 26], lB: [-16, 26] }],
  [0.5, { lean: 4, aF: [176, 2], aB: [168, 4], lF: [16, 14], lB: [-12, 14], lift: 3 }],
]);
def('d_steal_swipe', 0.36, false, [
  [0, { lean: 22, aF: [96, 6], aB: [-40, -20], lF: [38, 44], lB: [-30, 44] }],
  [0.4, { lean: 38, aF: [62, 0], aB: [-50, -10], lF: [50, 50], lB: [-34, 30] }],
  [0.65, { lean: 40, aF: [28, 14], aB: [-50, -10], lF: [52, 52], lB: [-34, 30] }],
  [1, { lean: 24, aF: [70, 20], aB: [-50, -24], lF: [34, 46], lB: [-32, 46] }],
]);
def('d_block', 0.7, false, [
  [0, { lean: 14, aF: [80, 60], aB: [-10, 40], lF: [30, 50], lB: [-20, 46] }],
  [0.4, { lean: 2, aF: [178, 0], aB: [20, 40], lF: [8, 10], lB: [-10, 20], lift: 14 }],
  [0.6, { lean: 6, aF: [150, -10], aB: [20, 40], lF: [10, 14], lB: [-10, 24], lift: 12 }],
  [1, { lean: 10, aF: [60, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
]);
def('box_out', 0.8, true, [
  [0, { lean: 28, aF: [-36, -30], aB: [-70, -24], lF: [36, 44], lB: [-30, 44] }],
  [0.5, { lean: 30, aF: [-42, -34], aB: [-76, -28], lF: [38, 48], lB: [-30, 48], dx: -1 }],
]);
def('deny', 0.8, true, [
  [0, { lean: 20, aF: [96, 0], aB: [-60, -20], lF: [36, 44], lB: [-32, 44] }],
  [0.5, { lean: 20, aF: [90, 8], aB: [-56, -26], lF: [32, 46], lB: [-28, 46] }],
]);

// ------------------------------------------------------------------ rebounding
def('rebound_jump', 0.6, false, [
  [0, { lean: 12, aF: [60, 60], aB: [66, 54], lF: [28, 50], lB: [-20, 48] }],
  [0.45, { lean: 0, aF: [176, 4], aB: [180, 0], lF: [8, 10], lB: [-8, 14], lift: 13 }],
  [0.7, { lean: 2, aF: [170, 20], aB: [174, 16], lF: [12, 20], lB: [-8, 24], lift: 9, ball: '2' }],
  [1, { lean: 14, aF: [70, 100], aB: [76, 92], lF: [26, 40], lB: [-18, 38], ball: '2' }],
]);
def('rebound_grab', 0.5, false, [
  [0, { lean: 4, aF: [160, 30], aB: [164, 26], lF: [14, 20], lB: [-10, 24], lift: 6, ball: '2' }],
  [0.5, { lean: 16, aF: [80, 110], aB: [86, 100], lF: [30, 46], lB: [-22, 44], ball: '2' }],
  [1, { lean: 20, aF: [60, 110], aB: [66, 100], lF: [30, 44], lB: [-20, 40], ball: '2' }],
]);
def('tip', 0.5, false, [
  [0, { lean: 10, aF: [70, 50], aB: [-10, 40], lF: [28, 50], lB: [-20, 48] }],
  [0.5, { lean: 0, aF: [174, -10], aB: [10, 40], lF: [6, 8], lB: [-8, 16], lift: 12 }],
  [1, { lean: 8, aF: [80, 30], aB: [-10, 30], lF: [18, 30], lB: [-10, 28] }],
]);
def('loose_ball_dive', 0.7, false, [
  [0, { lean: 40, aF: [80, 10], aB: [84, 8], lF: [40, 50], lB: [-30, 30] }],
  [0.4, { lean: 80, aF: [100, 0], aB: [104, 0], lF: [-40, 10], lB: [-60, 20], rootY: 10 }],
  [1, { lean: 88, aF: [100, 0], aB: [108, 0], lF: [-70, 8], lB: [-80, 16], rootY: 7 }],
]);

// ------------------------------------------------------------------ contact
def('foul_shove', 0.4, false, [
  [0, { lean: 10, aF: [60, 80], aB: [66, 74], lF: [24, 26], lB: [-18, 24] }],
  [0.4, { lean: 20, aF: [88, 4], aB: [92, 2], lF: [36, 30], lB: [-28, 16] }],
  [1, { lean: 10, aF: [60, 30], aB: [20, 30], lF: [20, 20], lB: [-14, 20] }],
]);
def('hit_reaction', 0.45, false, [
  [0, { lean: -4, head: -10, aF: [50, 40], aB: [-40, -20], lF: [16, 14], lB: [-10, 14] }],
  [0.4, { lean: -20, head: -20, aF: [70, 50], aB: [-100, -30], lF: [30, 10], lB: [-4, 30], dx: -3 }],
  [1, { lean: -6, head: -4, aF: [30, 30], aB: [-30, 10], lF: [14, 18], lB: [-10, 18], dx: -4 }],
]);
def('fall', 0.6, false, [
  [0, { lean: -20, head: -10, aF: [70, 50], aB: [-90, -30], lF: [30, 10], lB: [-4, 30] }],
  [0.5, { lean: -60, head: -10, aF: [100, 30], aB: [-120, -20], lF: [70, 30], lB: [50, 50], rootY: 14 }],
  [1, { lean: -84, head: 10, aF: [20, 10], aB: [-150, -10], lF: [88, 40], lB: [76, 70], rootY: 7 }],
]);
def('get_up', 0.8, false, [
  [0, { lean: -84, head: 10, aF: [20, 10], aB: [-150, -10], lF: [88, 40], lB: [76, 70], rootY: 7 }],
  [0.4, { lean: -20, head: 10, aF: [-30, -10], aB: [-60, -10], lF: [84, 100], lB: [70, 110], rootY: 12 }],
  [0.75, { lean: 34, aF: [20, 20], aB: [0, 10], lF: [50, 80], lB: [-10, 60] }],
  [1, {}],
]);
def('hold_arm', 1.2, true, [
  [0, { lean: 14, head: 14, aF: [20, 92], aB: [44, 100], lF: [10, 10], lB: [-8, 10] }],
  [0.5, { lean: 16, head: 18, aF: [22, 96], aB: [46, 104], lF: [10, 12], lB: [-8, 12] }],
]);

// ------------------------------------------------------------------ reactions
def('celebrate', 0.8, false, [
  [0, { lean: 4, aF: [60, 110], aB: [-10, 30], lF: [16, 20], lB: [-10, 20] }],
  [0.3, { lean: -4, head: -10, aF: [170, -30], aB: [-30, 20], lF: [8, 8], lB: [-8, 8], lift: 5 }],
  [0.6, { lean: 0, head: -6, aF: [150, 60], aB: [-20, 30], lF: [14, 20], lB: [-10, 20] }],
  [0.8, { lean: -4, head: -10, aF: [172, -20], aB: [-30, 20], lF: [8, 8], lB: [-8, 8], lift: 3 }],
  [1, {}],
]);
def('dejected', 1.4, false, [
  [0, {}],
  [0.3, { lean: 14, head: 26, aF: [150, 124], aB: [156, 116], lF: [10, 10], lB: [-8, 10] }],
  [0.8, { lean: 18, head: 30, aF: [148, 126], aB: [154, 118], lF: [10, 12], lB: [-8, 12] }],
  [1, { lean: 8, head: 12 }],
]);
def('taunt', 0.9, false, [
  [0, { lean: -2, aF: [96, 116], aB: [-100, -112], lF: [22, 12], lB: [-20, 12] }],
  [0.5, { lean: -6, head: -8, aF: [104, 124], aB: [-106, -120], lF: [24, 10], lB: [-22, 10], lift: 1 }],
  [1, { lean: -2, aF: [96, 116], aB: [-100, -112], lF: [22, 12], lB: [-20, 12] }],
]);
def('point_to_passer', 0.8, false, [
  [0, { aF: [40, 60] }],
  [0.3, { lean: 2, aF: [94, 0], aB: [-14, 20] }],
  [0.8, { lean: 2, aF: [98, -4], aB: [-14, 20] }],
  [1, {}],
]);
def('clap', 0.5, true, [
  [0, { lean: 6, aF: [56, 78], aB: [70, 58] }],
  [0.5, { lean: 6, aF: [44, 70], aB: [84, 50] }],
]);

// ------------------------------------------------------------------ bench / referees
def('sit', 2.0, true, [
  [0, { lean: 8, aF: [30, 50], aB: [24, 50], lF: [86, 86], lB: [80, 84], rootY: 15 }],
  [0.5, { lean: 10, aF: [32, 54], aB: [26, 54], lF: [86, 86], lB: [80, 84], rootY: 15 }],
]);
def('stand_cheer', 0.6, true, [
  [0, { lean: -2, aF: [170, -10], aB: [-160, 10], lF: [10, 8], lB: [-8, 8], lift: 3 }],
  [0.5, { lean: 2, aF: [140, 40], aB: [-130, -40], lF: [12, 16], lB: [-10, 16] }],
]);
def('ref_run', 0.62, true, cycle({ stride: 28, knee: 40, arm: 26, elbow: 60, lean: 8, bounce: 1 }));
def('ref_whistle', 0.7, false, [
  [0, {}],
  [0.3, { lean: 2, aF: [60, 138], aB: [-10, 16] }],
  [1, { lean: 2, aF: [62, 140], aB: [-10, 16] }],
]);
def('ref_foul_signal', 1.0, false, [
  [0, { aF: [60, 138] }],
  [0.3, { lean: -2, aF: [176, 0], aB: [-10, 16] }],
  [1, { lean: -2, aF: [178, 0], aB: [-10, 16] }],
]);
def('ref_count', 0.9, true, [
  [0, { aF: [150, 0], aB: [-10, 16] }],
  [0.5, { aF: [96, 0], aB: [-10, 16] }],
]);
def('ref_out_of_bounds', 0.9, false, [
  [0, { aF: [60, 138] }],
  [0.35, { aF: [92, 0], aB: [-10, 16] }],
  [1, { aF: [92, 0], aB: [-10, 16] }],
]);

// ================================================================== batch 2: 32 more animations
// ---- dribble moves
def('in_and_out', 0.44, false, [
  [0, { lean: 20, aF: [36, 34], aB: [-20, 30], lF: [34, 30], lB: [-24, 28], ball: 'F' }],
  [0.35, { lean: 22, aF: [10, 26], aB: [-10, 30], lF: [40, 40], lB: [-28, 30], dx: -1, ball: 'F' }],
  [0.65, { lean: 24, aF: [52, 20], aB: [-30, 36], lF: [46, 44], lB: [-30, 30], dx: 1, ball: 'F' }],
  [1, { lean: 22, aF: [40, 34], aB: [-26, 36], lF: [30, 34], lB: [-22, 28], ball: 'F' }],
]);
def('double_cross', 0.6, false, [
  [0, { lean: 20, aF: [40, 30], aB: [8, 28], lF: [36, 26], lB: [-26, 26], ball: 'F' }],
  [0.25, { lean: 24, aF: [8, 22], aB: [44, 30], lF: [22, 34], lB: [-32, 28], ball: 'B' }],
  [0.5, { lean: 22, aF: [-6, 30], aB: [40, 36], lF: [14, 28], lB: [-24, 26], ball: 'B' }],
  [0.72, { lean: 26, aF: [42, 26], aB: [10, 26], lF: [42, 40], lB: [-30, 30], ball: 'F' }],
  [1, { lean: 22, aF: [46, 32], aB: [-20, 34], lF: [34, 34], lB: [-24, 28], ball: 'F' }],
]);
def('snatch_back', 0.46, false, [
  [0, { lean: 26, aF: [50, 26], aB: [-24, 34], lF: [48, 40], lB: [-30, 30], ball: 'F' }],
  [0.4, { lean: 4, aF: [20, 50], aB: [-10, 40], lF: [30, 10], lB: [-10, 30], dx: -3, lift: 2, ball: 'F' }],
  [1, { lean: 10, aF: [30, 60], aB: [-16, 40], lF: [16, 24], lB: [-12, 24], dx: -6, ball: 'F' }],
]);
def('stutter_step', 0.5, false, [
  [0, { lean: 20, aF: [36, 36], aB: [-20, 34], lF: [30, 30], lB: [-20, 28], ball: 'F' }],
  [0.25, { lean: 16, aF: [34, 46], aB: [-16, 36], lF: [14, 40], lB: [-8, 16], lift: 1, ball: 'F' }],
  [0.5, { lean: 16, aF: [34, 40], aB: [-16, 36], lF: [6, 14], lB: [10, 44], lift: 1, ball: 'F' }],
  [0.75, { lean: 18, aF: [34, 46], aB: [-16, 36], lF: [14, 40], lB: [-8, 16], lift: 1, ball: 'F' }],
  [1, { lean: 26, aF: [48, 28], aB: [-30, 38], lF: [44, 42], lB: [-30, 30], ball: 'F' }],
]);
def('half_spin', 0.5, false, [
  [0, { lean: 18, aF: [34, 60], aB: [-10, 40], lF: [32, 30], lB: [-22, 28], ball: 'F' }],
  [0.35, { lean: 8, aF: [20, 90], aB: [30, 80], lF: [10, 30], lB: [-6, 30], ball: '2', flip: true }],
  [0.6, { lean: 10, aF: [24, 90], aB: [30, 80], lF: [-8, 30], lB: [14, 30], ball: '2', flip: true }],
  [1, { lean: 22, aF: [44, 34], aB: [-24, 36], lF: [40, 40], lB: [-28, 30], ball: 'F' }],
]);
def('size_up', 0.9, true, [
  [0, { lean: 14, aF: [30, 40], aB: [-30, -20], lF: [26, 28], lB: [-22, 26] }],
  [0.25, { lean: 18, aF: [38, 60], aB: [-34, -24], lF: [30, 36], lB: [-24, 30], dx: 1 }],
  [0.5, { lean: 12, aF: [26, 36], aB: [-26, -16], lF: [22, 22], lB: [-18, 22], dx: -1 }],
  [0.75, { lean: 18, aF: [38, 60], aB: [-34, -24], lF: [30, 36], lB: [-24, 30] }],
], { ball: 'drib' });
def('jab_step', 0.5, false, [
  [0, { lean: 20, aF: [40, 76], aB: [48, 66], lF: [28, 44], lB: [-8, 34], ball: '2' }],
  [0.4, { lean: 28, aF: [30, 70], aB: [40, 60], lF: [56, 30], lB: [-14, 30], dx: 2, ball: '2' }],
  [0.6, { lean: 28, aF: [30, 70], aB: [40, 60], lF: [56, 30], lB: [-14, 30], dx: 2, ball: '2' }],
  [1, { lean: 20, aF: [40, 76], aB: [48, 66], lF: [28, 44], lB: [-8, 34], ball: '2' }],
]);
def('pump_fake', 0.55, false, [
  [0, { lean: 20, aF: [40, 80], aB: [50, 70], lF: [26, 44], lB: [-8, 38], ball: '2' }],
  [0.4, { lean: 6, head: -6, aF: [118, 76], aB: [124, 62], lF: [18, 30], lB: [-8, 28], ball: '2' }],
  [0.6, { lean: 6, head: -6, aF: [122, 74], aB: [128, 60], lF: [18, 30], lB: [-8, 28], ball: '2' }],
  [1, { lean: 22, aF: [42, 80], aB: [50, 70], lF: [28, 46], lB: [-8, 40], ball: '2' }],
]);
def('push_cross', 0.5, false, [
  [0, { lean: 24, aF: [60, 10], aB: [-20, 30], lF: [44, 40], lB: [-28, 30], ball: 'F' }],
  [0.35, { lean: 30, aF: [72, 0], aB: [-10, 30], lF: [52, 46], lB: [-32, 30], dx: 2, ball: 'F' }],
  [0.6, { lean: 26, aF: [30, 10], aB: [50, 20], lF: [30, 36], lB: [-30, 28], ball: 'B' }],
  [1, { lean: 20, aF: [0, 30], aB: [40, 40], lF: [16, 26], lB: [-20, 26], ball: 'B' }],
]);
// ---- driving
def('drive_burst', 0.4, false, [
  [0, { lean: 22, aF: [40, 40], aB: [-20, 30], lF: [30, 34], lB: [-22, 30], ball: 'F' }],
  [0.4, { lean: 40, aF: [60, 20], aB: [-50, 60], lF: [64, 70], lB: [-40, 16], ball: 'F' }],
  [1, { lean: 34, aF: [56, 26], aB: [-40, 70], lF: [20, 20], lB: [40, 80], lift: 1, ball: 'F' }],
]);
def('jump_stop', 0.42, false, [
  [0, { lean: 24, aF: [50, 60], aB: [56, 54], lF: [50, 40], lB: [-30, 26], ball: '2' }],
  [0.4, { lean: 12, aF: [60, 90], aB: [66, 82], lF: [30, 40], lB: [16, 40], lift: 4, ball: '2' }],
  [1, { lean: 22, aF: [46, 96], aB: [52, 88], lF: [36, 56], lB: [-4, 50], ball: '2' }],
]);
const drive = (reach, extra) => [
  [0, { lean: 22, aF: [56, 76], aB: [62, 68], lF: [52, 30], lB: [-34, 24], ball: '2' }],
  ...extra,
  [1, { lean: 10, aF: [60, 30], aB: [20, 30], lF: [16, 28], lB: [-10, 24] }],
];
def('scoop_layup', 0.8, false, drive(0, [
  [0.35, { lean: 20, aF: [40, 20], aB: [60, 50], lF: [-10, 12], lB: [64, 80], lift: 7, ball: 'F' }],
  [0.6, { lean: 10, aF: [112, -6], aB: [50, 50], lF: [-14, 10], lB: [70, 88], lift: 12, ball: 'F' }],
  [0.78, { lean: 6, aF: [150, -20], aB: [44, 40], lF: [-8, 10], lB: [46, 56], lift: 9 }],
]), { rel: 0.6 });
def('reverse_layup', 0.85, false, drive(0, [
  [0.35, { lean: 6, aF: [130, 60], aB: [136, 52], lF: [-10, 12], lB: [60, 80], lift: 8, ball: '2' }],
  [0.6, { lean: -14, head: -14, aF: [196, 10], aB: [80, 40], lF: [-16, 10], lB: [56, 70], lift: 13, ball: 'F', flip: true }],
  [0.78, { lean: -10, aF: [186, -16], aB: [60, 40], lF: [-8, 12], lB: [40, 50], lift: 10, flip: true }],
]), { rel: 0.6 });
def('up_and_under', 0.95, false, [
  [0, { lean: -8, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2' }],
  [0.25, { lean: 2, head: -6, aF: [124, 70], aB: [130, 58], lF: [20, 30], lB: [-10, 30], ball: '2' }],
  [0.45, { lean: 36, aF: [40, 60], aB: [46, 54], lF: [60, 50], lB: [-30, 20], dx: 3, ball: '2' }],
  [0.68, { lean: 12, aF: [150, 10], aB: [60, 50], lF: [-10, 10], lB: [60, 80], lift: 9, dx: 5, ball: 'F' }],
  [0.82, { lean: 8, aF: [156, -20], aB: [50, 40], lF: [-6, 12], lB: [40, 50], lift: 7, dx: 5 }],
  [1, { lean: 10, aF: [60, 30], aB: [20, 30], lF: [16, 28], lB: [-10, 24], dx: 5 }],
], { rel: 0.68 });
def('contact_layup', 0.85, false, drive(0, [
  [0.3, { lean: 30, aF: [70, 90], aB: [76, 84], lF: [-6, 14], lB: [60, 80], lift: 6, ball: '2' }],
  [0.5, { lean: 18, head: -8, aF: [120, 60], aB: [126, 50], lF: [20, 40], lB: [50, 70], lift: 11, dx: -1, ball: '2' }],
  [0.62, { lean: -4, head: -12, aF: [166, 0], aB: [90, 60], lF: [30, 30], lB: [30, 60], lift: 12, dx: -2, ball: 'F' }],
  [0.8, { lean: -12, aF: [150, -20], aB: [60, 40], lF: [34, 20], lB: [10, 40], lift: 7, dx: -3 }],
]), { rel: 0.62 });
def('runner', 0.7, false, [
  [0, { lean: 26, aF: [56, 70], aB: [-30, 60], lF: [50, 40], lB: [-36, 24], ball: 'F' }],
  [0.4, { lean: 20, aF: [120, 50], aB: [-20, 50], lF: [-20, 10], lB: [60, 86], lift: 5, ball: 'F' }],
  [0.56, { lean: 14, aF: [158, 8], aB: [-10, 40], lF: [-28, 8], lB: [50, 70], lift: 8, ball: 'F' }],
  [0.75, { lean: 14, aF: [150, -26], aB: [10, 40], lF: [-10, 14], lB: [30, 40], lift: 5 }],
  [1, { lean: 14, aF: [70, 20], aB: [-20, 40], lF: [30, 40], lB: [-24, 24] }],
], { rel: 0.56 });
// ---- dunks (same timing contract as the first batch: gather to 0.3, slam at rel 0.68)
const dunk = (mid, slam) => [
  [0, { lean: 24, aF: [50, 70], aB: [60, 64], lF: [54, 34], lB: [-36, 26], ball: '2' }],
  ...mid, slam,
  [0.85, { lean: 8, aF: [150, 10], aB: [-10, 30], lF: [20, 40], lB: [0, 40], lift: 10 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
];
def('dunk_double_clutch', 0.95, false, dunk([
  [0.3, { lean: 8, aF: [150, 50], aB: [156, 42], lF: [30, 60], lB: [20, 60], lift: 11, ball: '2' }],
  [0.45, { lean: 20, aF: [60, 100], aB: [66, 92], lF: [60, 100], lB: [50, 100], lift: 17, ball: '2' }],
  [0.58, { lean: -8, aF: [190, 30], aB: [194, 24], lF: [30, 60], lB: [10, 50], lift: 20, ball: '2' }],
], [0.68, { lean: 16, aF: [120, 4], aB: [124, 2], lF: [40, 70], lB: [20, 60], lift: 18, ball: '2' }]), { rel: 0.68 });
def('dunk_cradle', 0.95, false, dunk([
  [0.3, { lean: 12, aF: [70, 100], aB: [20, 50], lF: [24, 50], lB: [50, 84], lift: 11, ball: 'F' }],
  [0.46, { lean: 4, aF: [20, 120], aB: [-20, 40], lF: [40, 80], lB: [20, 70], lift: 18, ball: 'F' }],
  [0.58, { lean: -6, aF: [160, 60], aB: [-30, 40], lF: [44, 86], lB: [16, 66], lift: 20, ball: 'F' }],
], [0.68, { lean: 16, aF: [116, 4], aB: [-40, 30], lF: [36, 76], lB: [14, 64], lift: 18, ball: 'F' }]), { rel: 0.68 });
def('putback_dunk', 0.8, false, dunk([
  [0.3, { lean: 2, aF: [176, 10], aB: [180, 6], lF: [10, 20], lB: [-8, 24], lift: 13, ball: '2' }],
  [0.5, { lean: -4, aF: [184, 26], aB: [188, 20], lF: [20, 50], lB: [6, 46], lift: 20, ball: '2' }],
], [0.68, { lean: 14, aF: [122, 4], aB: [126, 2], lF: [36, 70], lB: [24, 70], lift: 18, ball: '2' }]), { rel: 0.68 });
def('dunk_behind_head', 0.95, false, dunk([
  [0.3, { lean: 6, aF: [150, 60], aB: [156, 52], lF: [30, 60], lB: [20, 60], lift: 11, ball: '2' }],
  [0.52, { lean: -18, head: -6, aF: [206, 100], aB: [210, 92], lF: [50, 96], lB: [36, 96], lift: 20, ball: '2' }],
], [0.68, { lean: 18, aF: [118, 4], aB: [122, 2], lF: [44, 84], lB: [34, 84], lift: 18, ball: '2' }]), { rel: 0.68 });
// ---- shooting
def('deep_three', 1.05, false, [
  [0, { lean: 24, aF: [36, 86], aB: [46, 76], lF: [30, 56], lB: [-8, 50], ball: '2' }],
  [0.32, { lean: 14, aF: [70, 100], aB: [80, 88], lF: [28, 62], lB: [-8, 56], ball: '2' }],
  [0.5, { lean: 6, aF: [122, 78], aB: [128, 62], lF: [10, 14], lB: [-6, 14], lift: 5, ball: '2' }],
  [0.6, { lean: 4, head: -6, aF: [150, 8], aB: [130, 44], lF: [14, 10], lB: [-10, 24], lift: 12, dx: 1, ball: 'F' }],
  [0.76, { lean: 6, head: -6, aF: [140, -36], aB: [116, 40], lF: [20, 12], lB: [-14, 26], lift: 10, dx: 2 }],
  [1, { lean: 10, aF: [130, -30], aB: [60, 40], lF: [16, 26], lB: [-8, 22], dx: 3 }],
], { rel: 0.6 });
def('leaner', 0.85, false, [
  [0, { lean: 26, aF: [50, 80], aB: [56, 72], lF: [46, 40], lB: [-30, 26], ball: '2' }],
  [0.35, { lean: 24, aF: [84, 96], aB: [92, 84], lF: [30, 50], lB: [-10, 40], ball: '2' }],
  [0.5, { lean: 22, aF: [124, 70], aB: [130, 56], lF: [14, 14], lB: [-20, 30], lift: 5, dx: 2, ball: '2' }],
  [0.6, { lean: 20, head: -8, aF: [150, 10], aB: [128, 44], lF: [10, 10], lB: [-34, 40], lift: 9, dx: 4, ball: 'F' }],
  [0.78, { lean: 16, aF: [144, -30], aB: [110, 40], lF: [16, 14], lB: [-24, 30], lift: 6, dx: 5 }],
  [1, { lean: 12, aF: [120, -20], aB: [50, 40], lF: [20, 26], lB: [-10, 22], dx: 6 }],
], { rel: 0.6 });
def('turnaround_jumper', 1.0, false, [
  [0, { lean: -10, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2', flip: true }],
  [0.25, { lean: -4, aF: [80, 90], aB: [86, 82], lF: [10, 40], lB: [-10, 40], ball: '2', flip: true }],
  [0.42, { lean: 2, aF: [110, 86], aB: [118, 70], lF: [16, 40], lB: [-8, 36], lift: 2, ball: '2' }],
  [0.6, { lean: -14, head: -6, aF: [156, 12], aB: [132, 44], lF: [26, 10], lB: [-4, 16], lift: 10, dx: -3, ball: 'F' }],
  [0.76, { lean: -14, aF: [150, -34], aB: [118, 40], lF: [26, 12], lB: [-4, 18], lift: 8, dx: -4 }],
  [1, { lean: 4, aF: [136, -30], aB: [60, 40], lF: [14, 24], lB: [-8, 22], dx: -5 }],
], { rel: 0.6 });
def('hop_jumper', 0.95, false, [
  [0, { lean: 16, aF: [70, 30], aB: [76, 24], lF: [40, 30], lB: [-20, 20], lift: 3, dx: -3 }],
  [0.22, { lean: 22, aF: [44, 86], aB: [52, 76], lF: [30, 54], lB: [-6, 48], ball: '2' }],
  [0.42, { lean: 8, aF: [100, 92], aB: [108, 78], lF: [22, 40], lB: [-8, 36], ball: '2' }],
  [0.52, { lean: 2, aF: [126, 72], aB: [132, 56], lF: [10, 12], lB: [-6, 12], lift: 5, ball: '2' }],
  [0.6, { lean: -2, head: -6, aF: [158, 12], aB: [134, 44], lF: [6, 8], lB: [-4, 14], lift: 10, ball: 'F' }],
  [0.76, { lean: -2, head: -6, aF: [152, -34], aB: [120, 40], lF: [6, 10], lB: [-4, 16], lift: 9 }],
  [1, { lean: 6, aF: [140, -30], aB: [60, 40], lF: [14, 24], lB: [-8, 22] }],
], { rel: 0.6 });
def('one_leg_fade', 1.0, false, [
  [0, { lean: 14, aF: [44, 84], aB: [52, 74], lF: [26, 46], lB: [-8, 40], ball: '2' }],
  [0.32, { lean: 0, aF: [84, 96], aB: [92, 84], lF: [50, 80], lB: [-6, 30], ball: '2' }],
  [0.5, { lean: -14, aF: [126, 74], aB: [132, 58], lF: [70, 96], lB: [-2, 10], lift: 4, dx: -2, ball: '2' }],
  [0.6, { lean: -26, head: -4, aF: [160, 10], aB: [134, 44], lF: [76, 100], lB: [4, 6], lift: 8, dx: -4, ball: 'F' }],
  [0.78, { lean: -24, aF: [152, -34], aB: [118, 40], lF: [60, 70], lB: [4, 10], lift: 6, dx: -6 }],
  [1, { lean: 0, aF: [136, -30], aB: [60, 40], lF: [14, 24], lB: [-8, 22], dx: -7 }],
], { rel: 0.6 });
def('quick_release', 0.8, false, [
  [0, { lean: 14, aF: [66, 90], aB: [74, 80], lF: [20, 36], lB: [-8, 32], ball: '2' }],
  [0.3, { lean: 6, aF: [112, 84], aB: [120, 68], lF: [16, 30], lB: [-8, 26], ball: '2' }],
  [0.5, { lean: 2, aF: [140, 50], aB: [132, 52], lF: [8, 10], lB: [-6, 12], lift: 4, ball: '2' }],
  [0.6, { lean: 0, head: -6, aF: [160, 6], aB: [134, 44], lF: [8, 8], lB: [-4, 12], lift: 7, ball: 'F' }],
  [0.76, { lean: 0, aF: [154, -36], aB: [120, 40], lF: [8, 10], lB: [-4, 14], lift: 6 }],
  [1, { lean: 6, aF: [140, -30], aB: [60, 40], lF: [14, 22], lB: [-8, 20] }],
], { rel: 0.6 });
// ---- pick and roll
def('screen_set', 1.1, true, [
  [0, { lean: 6, aF: [30, 120], aB: [44, 112], lF: [30, 26], lB: [-28, 24] }],
  [0.5, { lean: 8, aF: [32, 124], aB: [46, 116], lF: [32, 30], lB: [-30, 28] }],
]);
def('screen_roll', 0.5, false, [
  [0, { lean: 6, aF: [30, 120], aB: [44, 112], lF: [30, 26], lB: [-28, 24] }],
  [0.4, { lean: 0, aF: [60, 60], aB: [-40, 30], lF: [-20, 30], lB: [30, 40], flip: true }],
  [1, { lean: 20, aF: [110, 20], aB: [-40, 50], lF: [46, 50], lB: [-30, 20] }],
]);
def('roll_call', 0.5, true, cycle({ stride: 44, knee: 66, lean: 18, bounce: 2, armF: [150, 20], armB: [-30, 60] }));
def('screen_fight', 0.5, false, [
  [0, { lean: 22, aF: [74, 16], aB: [-52, -22], lF: [34, 46], lB: [-32, 46] }],
  [0.4, { lean: 34, head: 8, aF: [20, 90], aB: [-80, -30], lF: [56, 50], lB: [-40, 20], dx: 1 }],
  [1, { lean: 24, aF: [70, 20], aB: [-50, -24], lF: [40, 46], lB: [-34, 40] }],
]);
// ---- defense
def('d_contest_jump', 0.7, false, [
  [0, { lean: 16, aF: [80, 50], aB: [-20, 40], lF: [32, 52], lB: [-22, 48] }],
  [0.35, { lean: 14, aF: [150, 10], aB: [10, 40], lF: [16, 14], lB: [-20, 30], lift: 9, dx: 2 }],
  [0.55, { lean: 18, aF: [140, 0], aB: [20, 40], lF: [20, 20], lB: [-26, 36], lift: 8, dx: 4 }],
  [1, { lean: 14, aF: [70, 30], aB: [-10, 30], lF: [24, 36], lB: [-14, 32], dx: 5 }],
]);
def('d_poke', 0.32, false, [
  [0, { lean: 22, aF: [70, 20], aB: [-50, -22], lF: [34, 46], lB: [-32, 46] }],
  [0.45, { lean: 30, aF: [50, 0], aB: [60, 0], lF: [46, 50], lB: [-36, 34] }],
  [1, { lean: 22, aF: [70, 20], aB: [-50, -24], lF: [34, 46], lB: [-32, 46] }],
]);

// ================================================================== batch 5: 67 more animations
const tw = (keys, f) => keys.map(([t, p], i) => [t, { ...p, ...f(p, i, t) }]);
// ---- jump shot bases and release blends (same contract as `jumper`: release at 0.6)
def('set_shot', 0.85, false, [
  [0, { lean: 16, aF: [44, 88], aB: [52, 78], lF: [20, 40], lB: [-8, 36], ball: '2' }],
  [0.35, { lean: 10, aF: [84, 104], aB: [92, 92], lF: [20, 46], lB: [-8, 42], ball: '2' }],
  [0.52, { lean: 4, aF: [128, 70], aB: [132, 56], lF: [10, 12], lB: [-6, 12], lift: 2, ball: '2' }],
  [0.6, { lean: 2, head: -5, aF: [160, 10], aB: [134, 44], lF: [8, 6], lB: [-6, 8], lift: 4, ball: 'F' }],
  [0.78, { lean: 2, head: -5, aF: [154, -36], aB: [120, 40], lF: [8, 8], lB: [-6, 10], lift: 3 }],
  [1, { lean: 6, aF: [140, -30], aB: [60, 40], lF: [12, 20], lB: [-8, 18] }],
], { rel: 0.6 });
def('high_release', 1.0, false, tw(jumper(0, -4, 4, 0), (p, i) => (i === 2 ? { aF: [140, 80], aB: [146, 64] } : i === 3 ? { aF: [174, 4], aB: [150, 30], lift: 12 } : i === 4 ? { aF: [168, -30], lift: 11 } : {})), { rel: 0.6 });
def('two_motion', 1.05, false, tw(jumper(2, -4, 8, 0), (p, i) => (i === 2 ? { aF: [150, 96], aB: [154, 80], lift: 9 } : i === 3 ? { lift: 12 } : i === 4 ? { lift: 10 } : {})), { rel: 0.6 });
def('one_motion', 0.8, false, tw(jumper(8, 4, 4, 1), (p, i) => (i === 1 ? { aF: [84, 110], aB: [92, 98] } : i === 2 ? { aF: [120, 90], aB: [126, 74], lift: 2 } : i === 3 || i === 4 ? { lift: 6 } : {})), { rel: 0.6 });
def('leg_kick_jumper', 1.0, false, jumper(-4, -12, 46, -2), { rel: 0.6 });
def('baseline_fade', 1.0, false, jumper(-14, -30, 30, -8), { rel: 0.6 });
def('corner_set', 0.9, false, tw(jumper(6, 0, 4, 0), (p, i) => (i <= 1 ? { lF: [28, 62], lB: [-8, 56] } : {})), { rel: 0.6 });
def('moving_three', 0.95, false, tw(jumper(10, 12, -10, 4), (p, i) => (i === 0 ? { lF: [44, 36], lB: [-30, 24] } : i === 3 || i === 4 ? { lB: [-30, 40] } : {})), { rel: 0.6 });
// ---- dribble pull-ups, hop / spin jumpers, go-to shots
def('pullup_cross', 1.0, false, [
  [0, { lean: 24, aF: [44, 28], aB: [6, 28], lF: [40, 34], lB: [-28, 28], ball: 'F' }],
  [0.16, { lean: 26, aF: [8, 22], aB: [46, 30], lF: [22, 34], lB: [-34, 28], ball: 'B' }],
  [0.32, { lean: 14, aF: [60, 90], aB: [70, 82], lF: [34, 50], lB: [-6, 40], ball: '2' }],
  ...jumper(-2, -6, 10, 2).slice(2),
], { rel: 0.6 });
def('pullup_hesi', 1.0, false, [
  [0, { lean: 22, aF: [40, 34], aB: [-22, 32], lF: [40, 40], lB: [-28, 28], ball: 'F' }],
  [0.18, { lean: 2, head: -6, aF: [30, 70], aB: [-10, 40], lF: [12, 10], lB: [-6, 10], lift: 1, ball: 'F' }],
  [0.34, { lean: 14, aF: [66, 96], aB: [76, 84], lF: [26, 50], lB: [-8, 44], ball: '2' }],
  ...jumper(0, -4, 8, 1).slice(2),
], { rel: 0.6 });
def('stepback_jumper', 1.05, false, [
  [0, { lean: 16, aF: [34, 60], aB: [40, 56], lF: [48, 14], lB: [-10, 40], ball: '2' }],
  [0.2, { lean: -8, aF: [40, 80], aB: [46, 74], lF: [52, 8], lB: [-30, 44], lift: 3, dx: -4, ball: '2' }],
  [0.36, { lean: 6, aF: [70, 96], aB: [80, 84], lF: [22, 48], lB: [-8, 44], dx: -7, ball: '2' }],
  ...tw(jumper(-4, -10, 14, 0).slice(2), () => ({ dx: -7 })),
], { rel: 0.6 });
def('side_step_jumper', 1.0, false, [
  [0, { lean: 20, aF: [40, 40], aB: [-20, 30], lF: [30, 34], lB: [-22, 30], ball: 'F' }],
  [0.2, { lean: 10, aF: [50, 80], aB: [56, 72], lF: [-20, 20], lB: [30, 30], lift: 3, ball: '2' }],
  [0.36, { lean: 12, aF: [70, 96], aB: [80, 84], lF: [26, 52], lB: [-10, 46], ball: '2' }],
  ...jumper(2, -2, 6, 0).slice(2),
], { rel: 0.6 });
def('spin_jumper', 1.1, false, [
  [0, { lean: 16, aF: [30, 100], aB: [34, 90], lF: [30, 30], lB: [-20, 30], ball: '2' }],
  [0.14, { lean: 10, aF: [24, 110], aB: [28, 100], lF: [14, 34], lB: [-8, 34], ball: '2', flip: true }],
  [0.28, { lean: 10, aF: [24, 110], aB: [28, 100], lF: [-10, 34], lB: [16, 34], ball: '2', flip: true }],
  [0.4, { lean: 8, aF: [80, 98], aB: [88, 86], lF: [24, 50], lB: [-8, 44], ball: '2' }],
  ...jumper(-4, -12, 16, -2).slice(2),
], { rel: 0.6 });
def('shimmy_fade', 1.15, false, [
  [0, { lean: -8, aF: [70, 84], aB: [76, 76], lF: [30, 44], lB: [-34, 48], ball: '2', flip: true }],
  [0.14, { lean: -2, head: 8, aF: [84, 90], aB: [60, 80], lF: [34, 46], lB: [-30, 46], dx: 1, ball: '2', flip: true }],
  [0.28, { lean: -12, head: -8, aF: [60, 84], aB: [84, 84], lF: [26, 44], lB: [-36, 50], dx: -1, ball: '2', flip: true }],
  [0.4, { lean: -2, aF: [96, 92], aB: [104, 78], lF: [18, 42], lB: [-8, 38], ball: '2' }],
  ...jumper(-12, -26, 36, -6).slice(2),
], { rel: 0.6 });
def('tear_drop', 0.75, false, [
  [0, { lean: 22, aF: [56, 80], aB: [62, 70], lF: [44, 30], lB: [-30, 22], ball: '2' }],
  [0.36, { lean: 10, aF: [120, 60], aB: [60, 50], lF: [16, 14], lB: [20, 50], lift: 5, ball: 'F' }],
  [0.55, { lean: 0, head: -8, aF: [172, 2], aB: [50, 50], lF: [8, 10], lB: [16, 40], lift: 10, ball: 'F' }],
  [0.75, { lean: 2, aF: [176, -30], aB: [40, 40], lF: [10, 14], lB: [-4, 24], lift: 6 }],
  [1, { lean: 8, aF: [120, -10], aB: [30, 40], lF: [12, 22], lB: [-8, 20] }],
], { rel: 0.55 });
def('running_hook', 0.8, false, [
  [0, { lean: 22, aF: [30, 60], aB: [60, 40], lF: [48, 34], lB: [-34, 24], ball: 'F' }],
  [0.38, { lean: 4, aF: [-50, 10], aB: [88, 30], lF: [-10, 10], lB: [56, 80], lift: 6, ball: 'F' }],
  [0.56, { lean: -8, aF: [-178, 0], aB: [90, 24], lF: [-14, 8], lB: [50, 70], lift: 11, dx: 1, ball: 'F' }],
  [0.74, { lean: -4, aF: [150, -20], aB: [80, 24], lF: [-6, 10], lB: [30, 40], lift: 8, dx: 2 }],
  [1, { lean: 8, aF: [110, -10], aB: [40, 30], lF: [14, 22], lB: [-10, 20], dx: 3 }],
], { rel: 0.56 });
// ---- free throw routines (same timing as `free_throw`: dribbles to 0.3, set at 0.42, release at 0.68)
def('free_throw_knees', 2.4, false, [
  [0, { lean: 20, aF: [30, 44], aB: [-10, 30], lF: [16, 30], lB: [-10, 28], ball: 'drib' }],
  [0.3, { lean: 24, aF: [34, 56], aB: [-10, 30], lF: [18, 36], lB: [-10, 34], ball: 'drib' }],
  [0.42, { lean: 26, aF: [40, 90], aB: [48, 80], lF: [24, 56], lB: [-10, 50], ball: '2' }],
  [0.58, { lean: 8, aF: [120, 78], aB: [126, 62], lF: [18, 40], lB: [-8, 36], ball: '2' }],
  [0.68, { lean: 0, head: -5, aF: [160, 10], aB: [134, 44], lF: [8, 6], lB: [-6, 6], lift: 2, ball: 'F' }],
  [0.8, { lean: 0, head: -5, aF: [154, -36], aB: [120, 40], lF: [8, 6], lB: [-6, 6], lift: 1 }],
  [1, { lean: 2, aF: [146, -34], aB: [70, 40], lF: [8, 6], lB: [-6, 6] }],
], { rel: 0.68 });
def('free_throw_spin', 2.1, false, [
  [0, { lean: 8, aF: [50, 90], aB: [58, 84], lF: [10, 12], lB: [-8, 12], ball: '2' }],
  [0.3, { lean: 10, head: 8, aF: [44, 100], aB: [64, 80], lF: [10, 14], lB: [-8, 14], ball: '2' }],
  [0.42, { lean: 16, aF: [48, 88], aB: [56, 78], lF: [18, 34], lB: [-8, 30], ball: '2' }],
  [0.58, { lean: 4, aF: [124, 76], aB: [130, 60], lF: [14, 28], lB: [-8, 24], ball: '2' }],
  [0.68, { lean: 0, head: -5, aF: [162, 10], aB: [136, 44], lF: [8, 6], lB: [-6, 6], lift: 1, ball: 'F' }],
  [0.8, { lean: 0, head: -5, aF: [156, -34], aB: [120, 40], lF: [8, 6], lB: [-6, 6], lift: 1 }],
  [1, { lean: 2, aF: [146, -34], aB: [70, 40], lF: [8, 6], lB: [-6, 6] }],
], { rel: 0.68 });
// ---- size-ups, breakdown combos, escapes
def('size_up_rock', 1.0, true, [
  [0, { lean: 18, aF: [36, 46], aB: [-30, -20], lF: [30, 32], lB: [-24, 28], dx: -1 }],
  [0.25, { lean: 22, aF: [30, 60], aB: [-26, -10], lF: [38, 40], lB: [-20, 24], dx: 1 }],
  [0.5, { lean: 18, aF: [10, 40], aB: [-34, -24], lF: [26, 28], lB: [-28, 32], dx: 2 }],
  [0.75, { lean: 14, aF: [30, 56], aB: [-30, -16], lF: [20, 22], lB: [-22, 26], dx: 0 }],
], { ball: 'drib' });
def('size_up_tween', 0.8, true, [
  [0, { lean: 24, aF: [30, 20], aB: [-14, 14], lF: [50, 50], lB: [-34, 30], ball: 'F' }],
  [0.25, { lean: 28, aF: [14, 8], aB: [-6, 8], lF: [52, 54], lB: [-36, 32], ball: 'F' }],
  [0.5, { lean: 26, aF: [10, 14], aB: [-18, 12], lF: [50, 50], lB: [-34, 30], ball: 'B' }],
  [0.75, { lean: 28, aF: [6, 8], aB: [-10, 6], lF: [52, 54], lB: [-36, 32], ball: 'B' }],
], { ball: 'F' });
def('combo_cross_tween', 0.72, false, [
  [0, { lean: 20, aF: [40, 30], aB: [8, 28], lF: [36, 26], lB: [-26, 26], ball: 'F' }],
  [0.22, { lean: 24, aF: [8, 22], aB: [44, 30], lF: [22, 34], lB: [-32, 28], ball: 'B' }],
  [0.45, { lean: 28, aF: [-6, 14], aB: [20, 10], lF: [52, 54], lB: [-36, 32], ball: 'B' }],
  [0.62, { lean: 28, aF: [24, 14], aB: [-10, 12], lF: [52, 52], lB: [-36, 30], ball: 'F' }],
  [1, { lean: 22, aF: [46, 32], aB: [-24, 34], lF: [34, 36], lB: [-24, 28], ball: 'F' }],
]);
def('combo_btb_cross', 0.74, false, [
  [0, { lean: 10, aF: [10, 20], aB: [-10, 20], lF: [24, 24], lB: [-16, 22], ball: 'F' }],
  [0.22, { lean: 6, aF: [-48, -18], aB: [-30, 10], lF: [26, 26], lB: [-18, 24], ball: 'F' }],
  [0.38, { lean: 8, aF: [-20, 10], aB: [-50, -10], lF: [28, 26], lB: [-18, 24], ball: 'B' }],
  [0.6, { lean: 22, aF: [10, 22], aB: [40, 28], lF: [36, 36], lB: [-28, 28], ball: 'B' }],
  [0.76, { lean: 24, aF: [40, 24], aB: [12, 26], lF: [42, 40], lB: [-30, 30], ball: 'F' }],
  [1, { lean: 20, aF: [44, 32], aB: [-22, 34], lF: [30, 32], lB: [-22, 28], ball: 'F' }],
]);
def('escape_retreat', 0.6, false, [
  [0, { lean: 22, aF: [44, 30], aB: [-70, -30], lF: [40, 36], lB: [-26, 28], ball: 'F' }],
  [0.35, { lean: 6, aF: [30, 40], aB: [-80, -34], lF: [34, 10], lB: [-30, 40], dx: -3, lift: 1, ball: 'F' }],
  [0.7, { lean: 4, aF: [28, 50], aB: [-76, -30], lF: [10, 30], lB: [-40, 20], dx: -6, lift: 1, ball: 'F' }],
  [1, { lean: 14, aF: [30, 44], aB: [-40, -10], lF: [20, 24], lB: [-14, 24], dx: -8, ball: 'F' }],
]);
def('drag_cross', 0.6, false, [
  [0, { lean: 24, aF: [60, 10], aB: [-20, 30], lF: [44, 40], lB: [-28, 30], ball: 'F' }],
  [0.3, { lean: 34, aF: [84, 0], aB: [-10, 30], lF: [58, 50], lB: [-34, 28], dx: 2, ball: 'F' }],
  [0.5, { lean: 30, aF: [70, 0], aB: [76, 0], lF: [50, 48], lB: [-34, 28], dx: 2, ball: 'B' }],
  [0.75, { lean: 20, aF: [0, 30], aB: [30, 30], lF: [20, 30], lB: [-26, 26], ball: 'B' }],
  [1, { lean: 20, aF: [-10, 30], aB: [40, 40], lF: [12, 24], lB: [-20, 24], ball: 'B' }],
]);
def('hang_hesi', 0.6, false, [
  [0, { lean: 20, aF: [40, 36], aB: [-22, 32], lF: [40, 40], lB: [-28, 28], ball: 'F' }],
  [0.3, { lean: -2, head: -8, aF: [50, 86], aB: [-10, 40], lF: [16, 10], lB: [-4, 8], lift: 3, ball: 'F' }],
  [0.62, { lean: 0, head: -8, aF: [54, 90], aB: [-6, 44], lF: [12, 10], lB: [-4, 10], lift: 1, ball: 'F' }],
  [1, { lean: 30, aF: [50, 26], aB: [-36, 44], lF: [50, 46], lB: [-32, 26], ball: 'F' }],
]);
def('wrap_behind', 0.5, false, [
  [0, { lean: 20, aF: [40, 30], aB: [-20, 30], lF: [44, 40], lB: [-30, 28], ball: 'F' }],
  [0.35, { lean: 16, aF: [-60, -24], aB: [-20, 20], lF: [20, 30], lB: [30, 60], lift: 1, ball: 'F' }],
  [0.6, { lean: 16, aF: [-30, 0], aB: [-56, -16], lF: [-20, 20], lB: [44, 50], ball: 'B' }],
  [1, { lean: 22, aF: [20, 30], aB: [30, 36], lF: [40, 38], lB: [-28, 28], ball: 'B' }],
]);
def('spin_reverse', 0.56, false, [
  [0, { lean: 20, aF: [36, 60], aB: [-10, 40], lF: [40, 36], lB: [-26, 28], ball: 'F' }],
  [0.25, { lean: 12, aF: [26, 104], aB: [30, 96], lF: [-10, 30], lB: [16, 34], ball: '2', flip: true }],
  [0.6, { lean: 12, aF: [26, 106], aB: [30, 98], lF: [16, 34], lB: [-10, 30], ball: '2', flip: true }],
  [0.8, { lean: 20, aF: [30, 60], aB: [-10, 36], lF: [34, 34], lB: [-22, 28], ball: 'B' }],
  [1, { lean: 26, aF: [-10, 30], aB: [44, 36], lF: [44, 42], lB: [-30, 28], ball: 'B' }],
]);
def('stepback_cross', 0.62, false, [
  [0, { lean: 14, aF: [30, 60], aB: [36, 56], lF: [46, 12], lB: [-10, 40], ball: 'F' }],
  [0.35, { lean: -8, aF: [34, 60], aB: [-10, 40], lF: [50, 6], lB: [-30, 44], lift: 3, dx: -4, ball: 'F' }],
  [0.6, { lean: 14, aF: [10, 24], aB: [40, 28], lF: [20, 34], lB: [-28, 30], dx: -6, ball: 'B' }],
  [1, { lean: 22, aF: [-8, 30], aB: [44, 38], lF: [34, 36], lB: [-24, 28], dx: -6, ball: 'B' }],
]);
// ---- triple threat and pivots (the dribble has been picked up)
def('triple_threat', 1.3, true, [
  [0, { lean: 26, aF: [20, 96], aB: [34, 88], lF: [36, 56], lB: [-14, 44], ball: '2' }],
  [0.5, { lean: 28, aF: [16, 100], aB: [30, 92], lF: [38, 60], lB: [-14, 48], ball: '2' }],
], { ball: '2' });
def('rip_through', 0.45, false, [
  [0, { lean: 26, aF: [20, 96], aB: [34, 88], lF: [36, 56], lB: [-14, 44], ball: '2' }],
  [0.4, { lean: 38, aF: [50, 30], aB: [60, 24], lF: [56, 60], lB: [-26, 30], dx: 1, ball: '2' }],
  [0.7, { lean: 34, aF: [-10, 40], aB: [0, 34], lF: [50, 56], lB: [-30, 30], dx: 2, ball: '2' }],
  [1, { lean: 26, aF: [20, 96], aB: [34, 88], lF: [36, 56], lB: [-14, 44], ball: '2' }],
]);
def('pivot_front', 0.5, false, [
  [0, { lean: 22, aF: [30, 90], aB: [42, 82], lF: [34, 50], lB: [-14, 42], ball: '2' }],
  [0.5, { lean: 18, aF: [60, 80], aB: [70, 72], lF: [60, 30], lB: [-10, 44], dx: 1, ball: '2' }],
  [1, { lean: 24, aF: [30, 94], aB: [42, 86], lF: [38, 54], lB: [-12, 44], ball: '2' }],
]);
def('pivot_reverse', 0.5, false, [
  [0, { lean: 22, aF: [30, 90], aB: [42, 82], lF: [34, 50], lB: [-14, 42], ball: '2', flip: true }],
  [0.5, { lean: 8, aF: [50, 100], aB: [60, 92], lF: [-30, 30], lB: [-12, 44], dx: -1, ball: '2', flip: true }],
  [0.55, { lean: 14, aF: [40, 96], aB: [50, 88], lF: [20, 40], lB: [-12, 44], ball: '2' }],
  [1, { lean: 24, aF: [30, 94], aB: [42, 86], lF: [38, 54], lB: [-12, 44], ball: '2' }],
]);
def('pass_fake', 0.4, false, [
  [0, { lean: 12, aF: [56, 86], aB: [62, 80], lF: [20, 16], lB: [-12, 16], ball: '2' }],
  [0.4, { lean: 18, aF: [80, 30], aB: [84, 26], lF: [34, 22], lB: [-20, 12], ball: '2' }],
  [1, { lean: 16, aF: [40, 90], aB: [48, 82], lF: [26, 30], lB: [-10, 26], ball: '2' }],
]);
// ---- contact, standing, one-foot / two-foot and signature dunks (gather to 0.3, slam at 0.68)
def('dunk_contact', 0.95, false, dunk([
  [0.3, { lean: 26, aF: [110, 70], aB: [80, 30], lF: [40, 70], lB: [30, 60], lift: 10, ball: 'F' }],
  [0.5, { lean: 22, aF: [170, 30], aB: [86, 10], lF: [60, 90], lB: [20, 60], lift: 18, dx: 1, ball: 'F' }],
], [0.68, { lean: 30, aF: [124, 4], aB: [70, 20], lF: [64, 96], lB: [10, 50], lift: 18, dx: 2, ball: 'F' }]), { rel: 0.68 });
def('dunk_poster', 1.0, false, dunk([
  [0.3, { lean: 16, aF: [140, 60], aB: [40, 40], lF: [60, 90], lB: [-10, 30], lift: 11, ball: 'F' }],
  [0.52, { lean: 4, aF: [196, 40], aB: [60, 20], lF: [80, 110], lB: [-20, 40], lift: 21, ball: 'F' }],
], [0.68, { lean: 22, aF: [118, 2], aB: [50, 20], lF: [70, 100], lB: [-10, 50], lift: 19, ball: 'F' }]), { rel: 0.68 });
def('dunk_standing_two', 0.75, false, [
  [0, { lean: 22, aF: [50, 100], aB: [58, 92], lF: [30, 60], lB: [-12, 56], ball: '2' }],
  [0.3, { lean: 6, aF: [150, 60], aB: [156, 52], lF: [8, 14], lB: [-8, 16], lift: 9, ball: '2' }],
  [0.55, { lean: -2, aF: [184, 26], aB: [188, 20], lF: [10, 20], lB: [-8, 24], lift: 16, ball: '2' }],
  [0.68, { lean: 12, aF: [124, 4], aB: [128, 2], lF: [16, 30], lB: [-6, 30], lift: 15, ball: '2' }],
  [0.85, { lean: 6, aF: [156, 8], aB: [160, 6], lF: [12, 24], lB: [-6, 24], lift: 8 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
], { rel: 0.68 });
def('dunk_standing_one', 0.75, false, [
  [0, { lean: 22, aF: [50, 100], aB: [58, 92], lF: [30, 60], lB: [-12, 56], ball: '2' }],
  [0.3, { lean: 8, aF: [140, 50], aB: [20, 50], lF: [8, 14], lB: [-8, 16], lift: 9, ball: 'F' }],
  [0.55, { lean: 0, aF: [180, 10], aB: [-10, 40], lF: [10, 20], lB: [-8, 24], lift: 16, ball: 'F' }],
  [0.68, { lean: 12, aF: [120, 6], aB: [-24, 30], lF: [16, 30], lB: [-6, 30], lift: 15, ball: 'F' }],
  [0.85, { lean: 6, aF: [150, 10], aB: [-10, 30], lF: [12, 24], lB: [-6, 24], lift: 8 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
], { rel: 0.68 });
def('dunk_glide', 1.0, false, dunk([
  [0.3, { lean: 30, aF: [100, 40], aB: [-40, 30], lF: [70, 30], lB: [-50, 20], lift: 9, ball: 'F' }],
  [0.52, { lean: 24, aF: [150, 20], aB: [-60, 20], lF: [60, 20], lB: [-60, 40], lift: 19, dx: 1, ball: 'F' }],
], [0.68, { lean: 20, aF: [120, 4], aB: [-50, 30], lF: [40, 40], lB: [-40, 60], lift: 18, dx: 2, ball: 'F' }]), { rel: 0.68 });
def('dunk_power', 0.9, false, dunk([
  [0.3, { lean: 20, aF: [60, 110], aB: [66, 102], lF: [40, 80], lB: [30, 80], lift: 6, ball: '2' }],
  [0.52, { lean: -4, aF: [190, 50], aB: [194, 44], lF: [30, 60], lB: [20, 60], lift: 20, ball: '2' }],
], [0.68, { lean: 20, aF: [118, 2], aB: [122, 0], lF: [50, 90], lB: [40, 90], lift: 18, ball: '2' }]), { rel: 0.68 });
def('dunk_side_clutch', 1.0, false, dunk([
  [0.3, { lean: 10, aF: [130, 60], aB: [136, 52], lF: [30, 60], lB: [20, 60], lift: 11, ball: '2' }],
  [0.46, { lean: 24, aF: [20, 80], aB: [26, 72], lF: [70, 100], lB: [56, 100], lift: 18, ball: '2' }],
  [0.58, { lean: -2, aF: [176, 40], aB: [20, 60], lF: [40, 70], lB: [16, 60], lift: 20, ball: 'F' }],
], [0.68, { lean: 16, aF: [118, 4], aB: [-30, 30], lF: [36, 76], lB: [14, 64], lift: 18, ball: 'F' }]), { rel: 0.68 });
def('dunk_spin', 1.05, false, dunk([
  [0.3, { lean: 10, aF: [130, 60], aB: [136, 52], lF: [30, 60], lB: [20, 60], lift: 11, ball: '2' }],
  [0.42, { lean: 4, aF: [110, 90], aB: [116, 82], lF: [40, 80], lB: [30, 80], lift: 17, ball: '2', flip: true }],
  [0.56, { lean: -4, aF: [170, 50], aB: [176, 44], lF: [44, 84], lB: [30, 80], lift: 20, ball: '2' }],
], [0.68, { lean: 16, aF: [120, 4], aB: [124, 2], lF: [40, 76], lB: [26, 70], lift: 18, ball: '2' }]), { rel: 0.68 });
// ---- alley-oop packages
def('alley_oop_one_hand', 0.85, false, [
  [0, { lean: 20, aF: [80, 30], aB: [-30, 30], lF: [54, 34], lB: [-36, 26] }],
  [0.3, { lean: 6, aF: [172, 10], aB: [-20, 40], lF: [20, 40], lB: [40, 76], lift: 12 }],
  [0.5, { lean: -6, aF: [190, 20], aB: [-30, 40], lF: [40, 76], lB: [16, 60], lift: 20, ball: 'F' }],
  [0.68, { lean: 16, aF: [118, 4], aB: [-40, 30], lF: [40, 80], lB: [14, 64], lift: 18, ball: 'F' }],
  [0.85, { lean: 8, aF: [150, 10], aB: [-10, 30], lF: [20, 40], lB: [0, 40], lift: 10 }],
  [1, { lean: 10, aF: [50, 30], aB: [-10, 30], lF: [18, 34], lB: [-10, 30] }],
], { rel: 0.68 });
def('alley_oop_layup', 0.85, false, [
  [0, { lean: 20, aF: [80, 30], aB: [86, 24], lF: [54, 34], lB: [-36, 26] }],
  [0.3, { lean: 6, aF: [168, 12], aB: [172, 8], lF: [-10, 12], lB: [60, 80], lift: 10 }],
  [0.5, { lean: 0, aF: [176, 20], aB: [180, 16], lF: [-14, 10], lB: [66, 86], lift: 15, ball: '2' }],
  [0.68, { lean: 4, aF: [166, 0], aB: [120, 40], lF: [-12, 10], lB: [56, 70], lift: 14, ball: 'F' }],
  [0.84, { lean: 6, aF: [156, -24], aB: [60, 40], lF: [-6, 12], lB: [36, 44], lift: 8 }],
  [1, { lean: 10, aF: [60, 30], aB: [20, 30], lF: [16, 28], lB: [-10, 24] }],
], { rel: 0.68 });
// ---- layup styles
def('hop_step_layup', 0.9, false, [
  [0, { lean: 24, aF: [56, 80], aB: [62, 72], lF: [50, 40], lB: [-30, 26], ball: '2' }],
  [0.22, { lean: 10, aF: [70, 96], aB: [76, 88], lF: [30, 44], lB: [18, 44], lift: 4, dx: 2, ball: '2' }],
  [0.4, { lean: 22, aF: [60, 100], aB: [66, 92], lF: [36, 60], lB: [-4, 54], dx: 3, ball: '2' }],
  [0.62, { lean: 6, aF: [168, 6], aB: [60, 50], lF: [6, 10], lB: [-8, 16], lift: 12, dx: 4, ball: 'F' }],
  [0.8, { lean: 4, aF: [160, -20], aB: [50, 40], lF: [8, 12], lB: [-6, 20], lift: 8, dx: 4 }],
  [1, { lean: 10, aF: [60, 30], aB: [20, 30], lF: [16, 28], lB: [-10, 24], dx: 4 }],
], { rel: 0.62 });
def('spin_layup', 0.95, false, [
  [0, { lean: 20, aF: [30, 100], aB: [34, 90], lF: [40, 34], lB: [-26, 28], ball: '2' }],
  [0.2, { lean: 10, aF: [24, 110], aB: [28, 100], lF: [10, 34], lB: [-8, 34], ball: '2', flip: true }],
  [0.38, { lean: 12, aF: [30, 106], aB: [36, 96], lF: [-14, 30], lB: [20, 36], ball: '2', flip: true }],
  [0.5, { lean: 14, aF: [110, 60], aB: [70, 60], lF: [-10, 12], lB: [64, 82], lift: 7, ball: 'F' }],
  [0.64, { lean: 6, aF: [168, 6], aB: [56, 50], lF: [-16, 10], lB: [72, 90], lift: 13, ball: 'F' }],
  [0.8, { lean: 4, aF: [160, -20], aB: [50, 40], lF: [-10, 10], lB: [50, 60], lift: 9 }],
  [1, { lean: 10, aF: [60, 30], aB: [20, 30], lF: [16, 28], lB: [-10, 24] }],
], { rel: 0.64 });
def('swoop_layup', 0.85, false, drive(0, [
  [0.35, { lean: 34, aF: [70, 30], aB: [-30, 40], lF: [-20, 12], lB: [70, 70], lift: 6, dx: 1, ball: 'F' }],
  [0.6, { lean: 30, aF: [128, 0], aB: [-50, 30], lF: [-30, 10], lB: [60, 60], lift: 11, dx: 3, ball: 'F' }],
  [0.78, { lean: 20, aF: [150, -16], aB: [-30, 30], lF: [-10, 12], lB: [40, 50], lift: 8, dx: 4 }],
]), { rel: 0.6 });
def('double_clutch_layup', 0.95, false, drive(0, [
  [0.3, { lean: 10, aF: [130, 60], aB: [136, 52], lF: [-10, 12], lB: [60, 80], lift: 9, ball: '2' }],
  [0.46, { lean: 18, aF: [50, 90], aB: [56, 82], lF: [40, 80], lB: [50, 90], lift: 13, ball: '2' }],
  [0.64, { lean: 2, aF: [160, 0], aB: [70, 50], lF: [10, 30], lB: [30, 60], lift: 12, ball: 'F' }],
  [0.8, { lean: 4, aF: [150, -20], aB: [50, 40], lF: [8, 14], lB: [10, 30], lift: 7 }],
]), { rel: 0.64 });
def('power_layup', 0.85, false, [
  [0, { lean: 26, aF: [50, 100], aB: [56, 92], lF: [40, 66], lB: [10, 60], ball: '2' }],
  [0.35, { lean: 20, aF: [60, 110], aB: [66, 102], lF: [36, 70], lB: [14, 66], ball: '2' }],
  [0.62, { lean: 4, aF: [164, 10], aB: [150, 30], lF: [8, 10], lB: [-6, 14], lift: 11, ball: '2' }],
  [0.8, { lean: 4, aF: [160, -16], aB: [120, 30], lF: [8, 12], lB: [-6, 16], lift: 7 }],
  [1, { lean: 10, aF: [60, 30], aB: [20, 30], lF: [16, 28], lB: [-10, 24] }],
], { rel: 0.62 });
// ---- passing styles
def('pass_behind_back', 0.4, false, [
  [0, { lean: 14, aF: [30, 60], aB: [-10, 30], lF: [26, 22], lB: [-16, 20], ball: 'F' }],
  [0.45, { lean: 8, aF: [-70, -40], aB: [30, 40], lF: [30, 24], lB: [-18, 22], ball: 'F' }],
  [1, { lean: 10, aF: [-96, -10], aB: [34, 44], lF: [28, 22], lB: [-16, 20] }],
], { rel: 0.45 });
def('pass_no_look', 0.38, false, [
  [0, { lean: 10, aF: [56, 86], aB: [62, 80], lF: [20, 16], lB: [-12, 16], ball: '2' }],
  [0.45, { lean: 12, head: -26, aF: [84, 8], aB: [70, 40], lF: [30, 20], lB: [-18, 14], ball: 'F' }],
  [1, { lean: 10, head: -30, aF: [86, 0], aB: [40, 40], lF: [30, 20], lB: [-18, 14] }],
], { rel: 0.45 });
def('pass_whip', 0.34, false, [
  [0, { lean: 18, aF: [-30, 60], aB: [40, 40], lF: [30, 30], lB: [-22, 24], ball: 'F' }],
  [0.45, { lean: 26, aF: [80, 6], aB: [-30, 40], lF: [46, 36], lB: [-30, 20], ball: 'F' }],
  [1, { lean: 22, aF: [96, 0], aB: [-40, 44], lF: [44, 34], lB: [-28, 20] }],
], { rel: 0.45 });
def('pass_lob', 0.46, false, [
  [0, { lean: 14, aF: [50, 90], aB: [56, 84], lF: [24, 30], lB: [-12, 26], ball: '2' }],
  [0.5, { lean: 0, head: -8, aF: [150, 30], aB: [120, 50], lF: [12, 10], lB: [-8, 10], lift: 2, ball: 'F' }],
  [1, { lean: 2, head: -8, aF: [162, -20], aB: [80, 40], lF: [12, 12], lB: [-8, 12] }],
], { rel: 0.5 });
def('pass_baseball', 0.44, false, [
  [0, { lean: -8, aF: [-150, 100], aB: [80, 20], lF: [10, 12], lB: [-30, 20], ball: 'F' }],
  [0.5, { lean: 16, aF: [130, 20], aB: [20, 40], lF: [40, 26], lB: [-26, 14], ball: 'F' }],
  [1, { lean: 22, aF: [70, 0], aB: [-10, 40], lF: [44, 30], lB: [-28, 12] }],
], { rel: 0.5 });
// ---- motion styles (bigs run upright, quick guards run low)
def('jog_big', 0.7, true, cycle({ stride: 26, knee: 38, arm: 22, elbow: 56, lean: 6, bounce: 1.8 }));
def('sprint_guard', 0.42, true, cycle({ stride: 56, knee: 84, arm: 60, elbow: 96, lean: 30, bounce: 1.6 }));
def('dribble_low', 0.5, true, cycle({ stride: 34, knee: 50, arm: 26, elbow: 50, lean: 24, bounce: 1, armF: [30, 22] }), { ball: 'drib' });
def('dribble_big', 0.66, true, cycle({ stride: 26, knee: 38, arm: 22, elbow: 56, lean: 10, bounce: 1.6, armF: [38, 50] }), { ball: 'drib' });
// ---- post moves (back to the basket: drawn facing away from the hoop unless flipped)
def('post_backdown', 0.6, true, [
  [0, { lean: -20, head: 12, aF: [40, 36], aB: [-80, -40], lF: [34, 56], lB: [-30, 56] }],
  [0.5, { lean: -26, head: 12, aF: [50, 60], aB: [-90, -44], lF: [24, 50], lB: [-44, 60], dx: -2 }],
], { ball: 'drib' });
def('post_spin', 0.6, false, [
  [0, { lean: -12, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2' }],
  [0.35, { lean: 4, aF: [60, 100], aB: [66, 92], lF: [10, 36], lB: [-8, 36], dx: -2, ball: '2', flip: true }],
  [0.65, { lean: 14, aF: [50, 96], aB: [56, 88], lF: [-10, 30], lB: [20, 36], dx: -4, ball: '2', flip: true }],
  [1, { lean: 22, aF: [70, 70], aB: [76, 62], lF: [48, 46], lB: [-24, 30], dx: -6, ball: '2', flip: true }],
]);
def('post_fake', 0.5, false, [
  [0, { lean: -10, head: 8, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2' }],
  [0.4, { lean: 4, head: 20, aF: [96, 70], aB: [100, 62], lF: [36, 48], lB: [-28, 44], dx: 2, ball: '2' }],
  [1, { lean: -12, head: 8, aF: [70, 84], aB: [76, 76], lF: [30, 46], lB: [-36, 50], ball: '2' }],
]);
def('post_fade', 1.05, false, [
  [0, { lean: -10, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2', flip: true }],
  [0.22, { lean: -2, aF: [84, 92], aB: [90, 84], lF: [14, 40], lB: [-10, 40], ball: '2', flip: true }],
  [0.4, { lean: -6, aF: [108, 88], aB: [116, 72], lF: [20, 42], lB: [-8, 38], lift: 1, ball: '2' }],
  ...jumper(-14, -30, 30, -8).slice(2),
], { rel: 0.6 });
def('post_hop_hook', 0.9, false, [
  [0, { lean: -10, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2', flip: true }],
  [0.25, { lean: 6, aF: [40, 90], aB: [70, 60], lF: [30, 50], lB: [14, 50], lift: 3, dx: 2, ball: '2' }],
  [0.42, { lean: 0, aF: [-50, 20], aB: [86, 30], lF: [10, 20], lB: [20, 50], lift: 5, dx: 3, ball: 'F' }],
  [0.58, { lean: -10, aF: [-176, 0], aB: [90, 24], lF: [4, 6], lB: [30, 56], lift: 11, dx: 3, ball: 'F' }],
  [0.76, { lean: -6, aF: [150, -20], aB: [80, 24], lF: [4, 8], lB: [16, 36], lift: 8, dx: 3 }],
  [1, { lean: 6, aF: [120, -10], aB: [40, 30], lF: [10, 20], lB: [-8, 20], dx: 3 }],
], { rel: 0.58 });
def('post_shake', 1.2, false, [
  [0, { lean: -10, aF: [70, 80], aB: [76, 72], lF: [30, 44], lB: [-34, 48], ball: '2', flip: true }],
  [0.14, { lean: 0, head: 16, aF: [90, 76], aB: [96, 68], lF: [36, 48], lB: [-26, 44], dx: 2, ball: '2', flip: true }],
  [0.3, { lean: -8, aF: [60, 100], aB: [66, 92], lF: [8, 36], lB: [-10, 36], ball: '2' }],
  [0.42, { lean: 4, aF: [100, 92], aB: [108, 78], lF: [20, 44], lB: [-8, 40], ball: '2' }],
  ...jumper(-6, -14, 14, -3).slice(2),
], { rel: 0.6 });
// ---- defense and off-ball
def('d_bite', 0.7, false, [
  [0, { lean: 18, aF: [80, 50], aB: [-20, 40], lF: [32, 52], lB: [-22, 48] }],
  [0.3, { lean: 16, aF: [170, 4], aB: [150, 20], lF: [20, 20], lB: [-30, 40], lift: 11, dx: 2 }],
  [0.6, { lean: 22, aF: [150, 0], aB: [120, 20], lF: [30, 30], lB: [-34, 44], lift: 8, dx: 5 }],
  [1, { lean: 30, aF: [60, 30], aB: [-10, 30], lF: [44, 56], lB: [-20, 40], dx: 7 }],
]);
def('d_trap', 0.6, true, [
  [0, { lean: 16, aF: [130, 10], aB: [-110, -10], lF: [40, 44], lB: [-38, 44] }],
  [0.5, { lean: 18, aF: [110, 20], aB: [-90, -20], lF: [36, 48], lB: [-34, 48], lift: 1 }],
]);
def('ft_lane', 1.6, true, [
  [0, { lean: 34, head: -10, aF: [14, 24], aB: [8, 22], lF: [26, 44], lB: [-14, 40] }],
  [0.5, { lean: 36, head: -10, aF: [14, 28], aB: [8, 26], lF: [26, 46], lB: [-14, 42] }],
]);
def('call_for_ball', 0.9, true, [
  [0, { lean: 4, aF: [168, 10], aB: [-10, 20], lF: [12, 12], lB: [-8, 12] }],
  [0.5, { lean: 4, aF: [176, -6], aB: [-10, 20], lF: [12, 14], lB: [-8, 14], lift: 1 }],
]);


// ================================================================== batch 6: dribble moves with a visible ball and footwork
// `bp` (ball path) puts the ball where the move shows it: [timeFraction, where, dx, behind]
//   where: 'F' / 'B' / '2' hand anchors, 'fl' a bounce on the floor (dx pixels ahead of the feet),
//   'hp' hip height (dx ahead); behind = 1 draws the ball behind the body (behind the back).
// Moves played while the player is moving use a '~run' copy whose legs keep stepping, so nobody slides.
def('crossover', 0.46, false, [
  [0, { lean: 22, aF: [36, 36], aB: [-12, 30], lF: [30, 30], lB: [-20, 28], ball: 'F' }],
  [0.3, { lean: 30, aF: [20, 20], aB: [20, 24], lF: [44, 46], lB: [-30, 30], dx: -1, ball: 'F' }],
  [0.5, { lean: 30, aF: [8, 18], aB: [30, 24], lF: [40, 44], lB: [-26, 34], ball: 'F' }],
  [0.7, { lean: 26, aF: [-6, 26], aB: [40, 30], lF: [16, 30], lB: [-30, 26], dx: 1, lift: 1, ball: 'B' }],
  [1, { lean: 22, aF: [-10, 30], aB: [38, 36], lF: [30, 30], lB: [-20, 28], dx: 1, ball: 'B' }],
], { bp: [[0, 'F'], [0.42, 'fl', 5], [0.7, 'B'], [1, 'B']] });
def('between_legs', 0.5, false, [
  [0, { lean: 22, aF: [34, 30], aB: [-14, 20], lF: [40, 40], lB: [-30, 30], ball: 'F' }],
  [0.35, { lean: 32, aF: [14, 6], aB: [-4, 8], lF: [56, 58], lB: [-40, 34], ball: 'F' }],
  [0.55, { lean: 32, aF: [6, 10], aB: [-10, 10], lF: [56, 58], lB: [-40, 34], ball: 'F' }],
  [0.75, { lean: 26, aF: [10, 26], aB: [-22, 16], lF: [44, 46], lB: [-34, 30], ball: 'B' }],
  [1, { lean: 20, aF: [20, 30], aB: [-26, 30], lF: [30, 34], lB: [-20, 28], ball: 'B' }],
], { bp: [[0, 'F'], [0.48, 'fl', 1], [0.74, 'B'], [1, 'B']] });
def('behind_back', 0.48, false, [
  [0, { lean: 14, aF: [20, 24], aB: [-10, 20], lF: [30, 28], lB: [-20, 26], ball: 'F' }],
  [0.3, { lean: 8, aF: [-40, -10], aB: [-20, 14], lF: [34, 30], lB: [-22, 26], ball: 'F' }],
  [0.5, { lean: 8, aF: [-56, -20], aB: [-40, 0], lF: [30, 30], lB: [-24, 28], ball: 'F' }],
  [0.72, { lean: 14, aF: [-10, 20], aB: [-30, 10], lF: [26, 28], lB: [-18, 26], ball: 'B' }],
  [1, { lean: 18, aF: [16, 30], aB: [24, 40], lF: [28, 28], lB: [-18, 24], ball: 'B' }],
], { bp: [[0, 'F'], [0.32, 'hp', -6, 1], [0.52, 'fl', -4, 1], [0.76, 'B'], [1, 'B']] });
def('hesitation', 0.56, false, [
  [0, { lean: 20, aF: [36, 38], aB: [-20, 30], lF: [34, 32], lB: [-22, 28], ball: 'F' }],
  [0.25, { lean: 4, head: -8, aF: [34, 70], aB: [-10, 40], lF: [12, 10], lB: [-6, 10], lift: 1, ball: 'F' }],
  [0.55, { lean: 2, head: -6, aF: [30, 74], aB: [-10, 40], lF: [10, 10], lB: [-6, 10], ball: 'F' }],
  [0.75, { lean: 28, aF: [44, 30], aB: [-30, 40], lF: [46, 44], lB: [-30, 30], ball: 'F' }],
  [1, { lean: 26, aF: [46, 30], aB: [-30, 40], lF: [34, 36], lB: [-24, 28], ball: 'F' }],
], { bp: [[0, 'F'], [0.18, 'fl', 5], [0.38, 'F'], [0.62, 'fl', 5], [0.82, 'F'], [1, 'F']] });
def('spin', 0.52, false, [
  [0, { lean: 16, aF: [30, 60], aB: [34, 50], lF: [30, 30], lB: [-20, 30], ball: 'F' }],
  [0.3, { lean: 10, aF: [24, 110], aB: [28, 100], lF: [14, 34], lB: [-8, 34], ball: '2', flip: true }],
  [0.7, { lean: 10, aF: [24, 110], aB: [28, 100], lF: [-10, 34], lB: [16, 34], ball: '2', flip: true }],
  [1, { lean: 18, aF: [36, 40], aB: [-10, 30], lF: [30, 30], lB: [-20, 28], ball: 'F' }],
], { bp: [[0, 'F'], [0.2, 'fl', 4], [0.4, 'hp', 3], [0.65, 'hp', -3, 1], [0.85, 'fl', 4], [1, 'F']] });
def('step_back', 0.5, false, [
  [0, { lean: 18, aF: [36, 36], aB: [-14, 30], lF: [44, 30], lB: [-20, 34], ball: 'F' }],
  [0.25, { lean: 14, aF: [30, 60], aB: [36, 56], lF: [46, 12], lB: [-10, 40], ball: 'F' }],
  [0.55, { lean: -10, aF: [34, 80], aB: [40, 74], lF: [50, 6], lB: [-30, 44], lift: 3, dx: -3, ball: '2' }],
  [1, { lean: -4, aF: [44, 86], aB: [50, 78], lF: [12, 26], lB: [-12, 26], dx: -4, ball: '2' }],
], { bp: [[0, 'F'], [0.22, 'fl', 6], [0.45, '2'], [1, '2']] });
def('shift', 0.42, false, [
  [0, { lean: 20, aF: [36, 36], aB: [-20, 30], lF: [30, 30], lB: [-20, 28], ball: 'F' }],
  [0.35, { lean: 24, aF: [30, 30], aB: [-24, 30], lF: [20, 20], lB: [-30, 34], lift: 3, dx: 1, ball: 'F' }],
  [0.65, { lean: 28, aF: [40, 30], aB: [-24, 30], lF: [46, 46], lB: [-26, 30], dx: 1, ball: 'F' }],
  [1, { lean: 22, aF: [36, 36], aB: [-20, 30], lF: [30, 32], lB: [-22, 28], ball: 'F' }],
], { bp: [[0, 'F'], [0.3, 'fl', 6], [0.55, 'F'], [0.82, 'fl', 5], [1, 'F']] });

/** Ball path from a move's hand changes: a bounce between hands (in front, through the legs or behind). */
function autoPath(an) {
  const kind = /tween|between/.test(an.name) ? [1, 0] : /behind|wrap|btb/.test(an.name) ? [-4, 1] : [5, 0];
  const pts = [];
  let prev = null;
  for (const [t, p] of an.keys) {
    const b = 'ball' in p ? p.ball : an.ball;
    if (b !== 'F' && b !== 'B' && b !== '2') continue;
    if (prev && prev.b !== b && prev.b !== '2' && b !== '2') pts.push([(prev.t + t) / 2, 'fl', kind[0], kind[1]]);
    else if (prev && prev.b === b && b !== '2' && t - prev.t > 0.28) pts.push([(prev.t + t) / 2, 'fl', 5, 0]);   // keeps dribbling
    pts.push([t, b]); prev = { t, b };
  }
  return pts.length > 1 ? pts : null;
}
export const DRIBBLE_MOVES = ['crossover', 'between_legs', 'behind_back', 'hesitation', 'spin', 'step_back', 'shift',
  'in_and_out', 'double_cross', 'snatch_back', 'stutter_step', 'half_spin', 'push_cross', 'combo_cross_tween', 'combo_btb_cross',
  'escape_retreat', 'drag_cross', 'hang_hesi', 'wrap_behind', 'spin_reverse', 'stepback_cross'];
for (const n of DRIBBLE_MOVES) {
  const an = A[n];
  if (!an.bp) an.bp = autoPath(an);
  // the moving version: same upper body, legs keep stepping (two steps), a little bounce
  const keys = [];
  for (let i = 0; i <= 8; i++) {
    const u = i / 8, sp = samplePose(an, u * an.dur), ph = u * Math.PI * 2, sn = Math.sin(ph), cs = Math.cos(ph);
    const k = { lean: Math.max(sp.lean, 12), head: sp.head, aF: sp.aF, aB: sp.aB, dx: sp.dx * 0.5, flip: sp.flip,
      lF: [32 * sn, 10 + 40 * Math.max(0, cs)], lB: [-32 * sn, 10 + 40 * Math.max(0, -cs)], lift: sp.lift + 1.2 * Math.abs(sn) };
    if (sp.ball === 'F' || sp.ball === 'B' || sp.ball === '2') k.ball = sp.ball;
    keys.push([u, k]);
  }
  def(n + '~run', an.dur, false, keys, { bp: an.bp, ball: an.ball });
}

export const ANIMS = A;
export const ANIM_GROUPS = {
  Locomotion: ['idle', 'idle_ball', 'idle_tired', 'walk', 'jog', 'sprint', 'backpedal', 'side_shuffle'],
  Dribble: ['dribble_stand', 'dribble_jog', 'dribble_sprint', 'protect_ball'],
  Post: ['post_up', 'post_hold', 'drop_step'],
  Moves: ['crossover', 'between_legs', 'behind_back', 'spin', 'hesitation', 'step_back', 'euro_step'],
  Passing: ['chest_pass', 'bounce_pass', 'overhead_pass', 'catch'],
  Shooting: ['jumper', 'pull_up', 'fadeaway', 'free_throw', 'floater', 'hook'],
  Layups: ['layup_right', 'layup_left', 'finger_roll'],
  Dunks: ['dunk_one_hand', 'dunk_two_hand', 'windmill', 'tomahawk', 'reverse', 'alley_oop_catch', 'rim_hang'],
  Defense: ['d_stance', 'd_slide', 'd_closeout', 'd_hands_up', 'd_steal_swipe', 'd_block', 'box_out', 'deny'],
  Rebounding: ['rebound_jump', 'rebound_grab', 'tip', 'loose_ball_dive'],
  Contact: ['foul_shove', 'hit_reaction', 'fall', 'get_up', 'hold_arm'],
  Reactions: ['celebrate', 'dejected', 'taunt', 'point_to_passer', 'clap'],
  'Moves 2': ['in_and_out', 'double_cross', 'snatch_back', 'stutter_step', 'half_spin', 'size_up', 'jab_step', 'pump_fake', 'push_cross'],
  'Driving': ['drive_burst', 'jump_stop', 'scoop_layup', 'reverse_layup', 'up_and_under', 'contact_layup', 'runner'],
  'Dunks 2': ['dunk_double_clutch', 'dunk_cradle', 'putback_dunk', 'dunk_behind_head'],
  'Shooting 2': ['deep_three', 'leaner', 'turnaround_jumper', 'hop_jumper', 'one_leg_fade', 'quick_release'],
  'Pick and roll': ['screen_set', 'screen_roll', 'roll_call', 'screen_fight'],
  'Defense 2': ['d_contest_jump', 'd_poke'],
  'Jump shots (batch 5)': ['set_shot', 'high_release', 'two_motion', 'one_motion', 'corner_set', 'moving_three', 'free_throw_knees', 'free_throw_spin'],
  'Pull-ups, go-to shots': ['pullup_cross', 'pullup_hesi', 'stepback_jumper', 'side_step_jumper', 'spin_jumper', 'leg_kick_jumper', 'baseline_fade', 'shimmy_fade', 'tear_drop', 'running_hook'],
  'Size-ups, combos, escapes': ['size_up_rock', 'size_up_tween', 'combo_cross_tween', 'combo_btb_cross', 'escape_retreat', 'drag_cross', 'hang_hesi', 'wrap_behind', 'spin_reverse', 'stepback_cross'],
  'Triple threat': ['triple_threat', 'rip_through', 'pivot_front', 'pivot_reverse', 'pass_fake'],
  'Dunks 3': ['dunk_contact', 'dunk_poster', 'dunk_standing_two', 'dunk_standing_one', 'dunk_glide', 'dunk_power', 'dunk_side_clutch', 'dunk_spin', 'alley_oop_one_hand', 'alley_oop_layup'],
  'Layups 2': ['hop_step_layup', 'spin_layup', 'swoop_layup', 'double_clutch_layup', 'power_layup'],
  'Passing 2': ['pass_behind_back', 'pass_no_look', 'pass_whip', 'pass_lob', 'pass_baseball'],
  'Motion styles': ['jog_big', 'sprint_guard', 'dribble_low', 'dribble_big'],
  'Post 2': ['post_backdown', 'post_spin', 'post_fake', 'post_fade', 'post_hop_hook', 'post_shake'],
  'Defense 3': ['d_bite', 'd_trap', 'ft_lane', 'call_for_ball'],
  'Bench/Refs': ['sit', 'stand_cheer', 'ref_run', 'ref_whistle', 'ref_foul_signal', 'ref_count', 'ref_out_of_bounds'],
};

export const FPS = 14; // bake rate

/** Pose of `anim` at time t seconds (speed already applied by the caller). */
export function samplePose(anim, t) {
  let f = anim.loop ? ((t / anim.dur) % 1 + 1) % 1 : Math.max(0, Math.min(1, t / anim.dur));
  const keys = anim.keys;
  let i = keys.length - 1;
  for (let k = 0; k < keys.length; k++) if (keys[k][0] <= f) i = k; else break;
  const a = keys[i];
  let b, span;
  if (i + 1 < keys.length) { b = keys[i + 1]; span = b[0] - a[0]; }
  else if (anim.loop) { b = keys[0]; span = 1 - a[0]; }
  else { b = a; span = 1; }
  const u = span > 0 ? (f - a[0]) / span : 0;
  const pa = { ...BASE_POSE, ...a[1] }, pb = { ...BASE_POSE, ...b[1] };
  const mix = (x, y) => x + (y - x) * u;
  const pose = {
    lean: mix(pa.lean, pb.lean), head: mix(pa.head, pb.head),
    aF: [mix(pa.aF[0], pb.aF[0]), mix(pa.aF[1], pb.aF[1])], aB: [mix(pa.aB[0], pb.aB[0]), mix(pa.aB[1], pb.aB[1])],
    lF: [mix(pa.lF[0], pb.lF[0]), mix(pa.lF[1], pb.lF[1])], lB: [mix(pa.lB[0], pb.lB[0]), mix(pa.lB[1], pb.lB[1])],
    lift: mix(pa.lift, pb.lift), dx: mix(pa.dx, pb.dx),
    rootY: pa.rootY != null && pb.rootY != null ? mix(pa.rootY, pb.rootY) : (pa.rootY ?? pb.rootY),
    flip: pa.flip, ball: 'ball' in a[1] ? a[1].ball : anim.ball,
    ikB: pa.ikB != null && pb.ikB != null ? mix(pa.ikB, pb.ikB) : (u < 0.5 ? pa.ikB : pb.ikB),
  };
  return pose;
}

export function frameCount(anim) { return Math.max(2, Math.round(anim.dur * FPS)); }
/** Frame index for time t (quantized to the bake rate). */
export function frameAt(anim, t) {
  const n = frameCount(anim);
  const f = anim.loop ? ((t / anim.dur) % 1 + 1) % 1 : Math.max(0, Math.min(0.9999, t / anim.dur));
  return Math.min(n - 1, Math.floor(f * n));
}

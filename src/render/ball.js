// The ball: a 7px sprite with 4 spin frames (seam positions), drawn centred on integer pixels.
const O = '#3a1a0c', B = '#e2762a', L = '#f59a4a', S = '#7a3413';
const SHAPE = ['..ooo..', '.obbbo.', 'oblbbbo', 'obbbbbo', 'obbbbbo', '.obbbo.', '..ooo..'];
const SEAMS = [
  [[3, 1], [3, 2], [3, 3], [3, 4], [3, 5], [1, 3], [2, 3], [4, 3], [5, 3]],
  [[2, 1], [2, 2], [3, 3], [4, 4], [4, 5], [1, 4], [2, 4], [4, 2], [5, 2]],
  [[1, 2], [2, 2], [3, 3], [4, 4], [5, 4], [2, 5], [2, 4], [4, 2], [4, 1]],
  [[4, 1], [4, 2], [3, 3], [2, 4], [2, 5], [1, 2], [2, 2], [4, 4], [5, 4]],
];

export function drawBall(ctx, x, y, spin = 0) {
  x = Math.round(x) - 3; y = Math.round(y) - 3;
  for (let r = 0; r < 7; r++) for (let c = 0; c < 7; c++) {
    const ch = SHAPE[r][c];
    if (ch === '.') continue;
    ctx.fillStyle = ch === 'o' ? O : ch === 'l' ? L : B;
    ctx.fillRect(x + c, y + r, 1, 1);
  }
  ctx.fillStyle = S;
  for (const [c, r] of SEAMS[((spin | 0) % 4 + 4) % 4]) ctx.fillRect(x + c, y + r, 1, 1);
}

export function drawShadow(ctx, x, y, w = 9) {
  x = Math.round(x); y = Math.round(y);
  const h = w >> 1;
  ctx.fillStyle = 'rgba(20,12,8,.30)';
  ctx.fillRect(x - h, y - 1, w, 2);
  ctx.fillRect(x - h + 2, y - 2, w - 4, 1);
  ctx.fillRect(x - h + 2, y + 1, w - 4, 1);
}

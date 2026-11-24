// Builds dist/mini2k.html: the whole game (code + data) in ONE file that opens with a double click,
// no server needed. The source in src/ stays the place to edit; re-run this after changes:
//   node tools/build_standalone.mjs
// No dependencies: each module is embedded as text and loaded through blob URLs in dependency order.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const src = path.join(root, 'src');
const IMPORT = /(\bfrom\s*|\bimport\s*)(['"])(\.{1,2}\/[^'"]+)\2/g;

const order = [], seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const code = fs.readFileSync(file, 'utf8');
  for (const m of code.matchAll(IMPORT)) visit(path.resolve(path.dirname(file), m[3]));
  order.push(file);
}
visit(path.join(src, 'main.js'));

const id = (f) => path.relative(src, f).split(path.sep).join('/');
const mods = order.map((f) => ({
  id: id(f),
  // specifiers become absolute ids so the loader can swap in blob URLs
  code: fs.readFileSync(f, 'utf8').replace(IMPORT, (_, a, q, spec) => `${a}${q}@@${id(path.resolve(path.dirname(f), spec))}@@${q}`),
}));
const json = (n) => JSON.parse(fs.readFileSync(path.join(root, 'data', n), 'utf8'));
const data = { players: json('players.json'), teams: json('teams.json'), appearance: json('appearance.json') };
const safe = (s) => s.replace(/<\/(script)/gi, '<\\/$1').replace(/<!--/g, '<\\!--');

const loader = `
window.__MINI2K_DATA = JSON.parse(document.getElementById('mini2k-data').textContent);
const urls = {};
for (const el of document.querySelectorAll('script[data-mod]')) {
  const code = el.textContent.replace(/@@([^@]+)@@/g, (_, m) => urls[m]);
  urls[el.dataset.mod] = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
}
import(urls['main.js']).catch((e) => { document.getElementById('err').textContent = 'Error: ' + e.message; });
`;

let html = fs.readFileSync(path.join(src, 'index.html'), 'utf8');
const tag = '<script type="module" src="main.js"></script>';
if (!html.includes(tag)) throw new Error('index.html: main.js script tag not found');
html = html.replace(tag, () => [
  `<script type="application/json" id="mini2k-data">${safe(JSON.stringify(data))}</script>`,
  ...mods.map((m) => `<script type="text/plain" data-mod="${m.id}">${safe(m.code)}</script>`),
  `<script type="module">${loader}</script>`,
].join('\n'));

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
const outName = 'mini2k-mobile.html';
const out = path.join(root, 'dist', outName);
fs.writeFileSync(out, html);
console.log(`built ${path.relative(root, out)}: ${mods.length} modules, ${(html.length / 1024).toFixed(0)} KB`);

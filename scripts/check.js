'use strict';
// `npm run build`: the app has no compile step (the browser code is served
// as-is), so the build syntax-checks every server and client file instead.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const files = ['server.js', ...['src', 'public', 'scripts'].flatMap((dir) =>
  fs.readdirSync(path.join(root, dir)).filter((f) => f.endsWith('.js')).map((f) => path.join(dir, f)))];

let failed = 0;
for (const file of files) {
  const r = spawnSync(process.execPath, ['--check', path.join(root, file)], { encoding: 'utf8' });
  if (r.status !== 0) { failed++; process.stderr.write(`✗ ${file}\n${r.stderr}\n`); }
  else console.log(`✓ ${file}`);
}
if (failed) { console.error(`\nBuild failed: ${failed} file(s) have errors.`); process.exit(1); }
console.log(`\nBuild passed: ${files.length} files checked.`);

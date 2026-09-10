import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const files = ['client/admin.js', 'client/tenant.js', 'client/login.js'];
const failures = [];

for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) failures.push(`${file}: ${result.stderr.trim()}`);
}

for (const file of ['client/admin.html', 'client/tenant.html', 'client/login.html']) {
  const source = await readFile(file, 'utf8');
  if (!source.trim().startsWith('<!doctype html>')) failures.push(`${file}: missing doctype`);
  if (!source.includes('lang="en"')) failures.push(`${file}: missing document language`);
  if (!source.includes('viewport')) failures.push(`${file}: missing viewport metadata`);
}

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(`Lint passed: ${files.length + 2} client assets checked.`);

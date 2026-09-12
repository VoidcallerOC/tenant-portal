import { spawnSync } from 'node:child_process';

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

if (process.env.DATABASE_URL) {
  const migration = spawnSync(command, ['db:migrate'], { stdio: 'inherit', env: process.env });
  if (migration.status !== 0) process.exit(migration.status ?? 1);
} else {
  console.warn('DATABASE_URL is not set; skipping local database migrations. Production builds must provide DATABASE_URL.');
}

for (const script of ['typecheck', 'lint']) {
  const result = spawnSync(command, [script], { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

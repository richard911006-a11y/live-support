import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = resolve(fileURLToPath(new URL('..', import.meta.url)));
const result = spawnSync(
  process.execPath,
  [
    resolve(rootDir, 'scripts', 'run-ts.mjs'),
    resolve(rootDir, 'scripts', 'telegram-setup.ts'),
    ...process.argv.slice(2),
  ],
  { stdio: 'inherit' },
);

process.exitCode = result.status ?? 1;

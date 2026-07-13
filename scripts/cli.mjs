import { spawnSync } from 'node:child_process';

const WINDOWS_COMMANDS = new Map([
  ['git', 'git.exe'],
  ['gh', 'gh.exe'],
  ['pnpm', 'pnpm.cmd'],
  ['wrangler', 'wrangler.cmd'],
]);

export function runCommand(command, args = [], options = {}) {
  const executable =
    process.platform === 'win32' ? (WINDOWS_COMMANDS.get(command) ?? command) : command;
  const result = spawnSync(executable, args, {
    cwd: options.cwd,
    env: options.env,
    encoding: 'utf8',
    shell: executable.endsWith('.cmd'),
    timeout: options.timeoutMs ?? 120_000,
  });

  return {
    ok: result.status === 0,
    status: result.status,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    error: result.error,
  };
}

export function printCommandOutput(result) {
  if (result.stdout.trim().length > 0) {
    process.stdout.write(result.stdout);
  }

  if (result.stderr.trim().length > 0) {
    process.stderr.write(result.stderr);
  }
}

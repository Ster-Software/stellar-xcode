import { execFile } from 'node:child_process';

/** Runs a command and resolves with its stdout; rejects with stderr (or the error) in the message. */
export function run(command, args, { timeout = 120_000, cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, cwd, maxBuffer: 32 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        const detail = (stderr || '').trim() || error.message;
        reject(new Error(`${command} ${args.join(' ')}: ${detail}`));
        return;
      }
      resolve(stdout);
    });
  });
}

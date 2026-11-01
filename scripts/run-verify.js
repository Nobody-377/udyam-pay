import { execSync } from 'node:child_process';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve(process.cwd());
const distDir = join(root, 'dist-verify');

let exitCode = 0;

try {
  console.log('Compiling verification script...');
  execSync('npx tsc -p tsconfig.verify.json', { stdio: 'inherit' });

  writeFileSync(join(distDir, 'package.json'), JSON.stringify({ type: 'commonjs' }));

  console.log('Running logic verification on Node.js runtime...');
  execSync(`node "${join(distDir, 'scripts', 'verify-logic.js')}"`, { stdio: 'inherit' });
} catch (error) {
  exitCode =
    typeof error === 'object' && error !== null && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 1;
} finally {
  if (existsSync(distDir)) {
    try {
      rmSync(distDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

if (exitCode !== 0) {
  process.exit(exitCode);
}


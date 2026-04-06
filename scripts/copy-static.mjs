import { copyFileSync, cpSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const target = process.argv[2];
const outDirArg = process.argv[3];

if (!['chrome', 'firefox'].includes(target)) {
  console.error(`Unsupported browser target: ${target || '(missing)'}`);
  process.exit(1);
}

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, outDirArg || path.join('dist', target));
const manifestName = target === 'firefox' ? 'manifest.firefox.json' : 'manifest.json';

mkdirSync(outDir, { recursive: true });
copyFileSync(path.resolve(rootDir, manifestName), path.resolve(outDir, 'manifest.json'));
cpSync(path.resolve(rootDir, 'icons'), path.resolve(outDir, 'icons'), {
  recursive: true,
  force: true
});
copyFileSync(path.resolve(rootDir, 'sandbox.html'), path.resolve(outDir, 'sandbox.html'));

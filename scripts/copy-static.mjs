import { copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
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

function copyDirectoryRecursive(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = path.resolve(sourceDir, entry.name);
    const targetPath = path.resolve(targetDir, entry.name);

    if (entry.isDirectory()) {
      copyDirectoryRecursive(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile() || statSync(sourcePath).isFile()) {
      copyFileSync(sourcePath, targetPath);
    }
  }
}

mkdirSync(outDir, { recursive: true });
copyFileSync(path.resolve(rootDir, manifestName), path.resolve(outDir, 'manifest.json'));
copyDirectoryRecursive(path.resolve(rootDir, 'icons'), path.resolve(outDir, 'icons'));
copyFileSync(path.resolve(rootDir, 'sandbox.html'), path.resolve(outDir, 'sandbox.html'));

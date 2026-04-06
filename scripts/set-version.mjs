import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const nextVersion = process.argv[2]?.trim();

if (!nextVersion) {
  console.error('Usage: node scripts/set-version.mjs <version>');
  process.exit(1);
}

if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z-.]+)?(?:\+[0-9A-Za-z-.]+)?$/.test(nextVersion)) {
  console.error(`Invalid semver version: ${nextVersion}`);
  process.exit(1);
}

const rootDir = process.cwd();
const versionFile = path.resolve(rootDir, 'version.json');
const syncScript = path.resolve(rootDir, 'scripts', 'sync-version.mjs');

writeFileSync(versionFile, `${JSON.stringify({ version: nextVersion }, null, 2)}\n`);

const result = spawnSync(process.execPath, [syncScript], {
  cwd: rootDir,
  stdio: 'inherit'
});

process.exit(result.status ?? 1);

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const rootDir = process.cwd();
const versionFile = path.resolve(rootDir, 'version.json');

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, 'utf8'));
}

function writeJson(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const { version } = readJson(versionFile);

if (typeof version !== 'string' || !version.trim()) {
  console.error('version.json must contain a non-empty "version" string.');
  process.exit(1);
}

const filesToSync = ['package.json', 'package-lock.json', 'manifest.json', 'manifest.firefox.json'];

for (const relativePath of filesToSync) {
  const filePath = path.resolve(rootDir, relativePath);
  const json = readJson(filePath);

  if (json.version !== undefined) {
    json.version = version;
  }

  if (relativePath === 'package-lock.json' && json.packages?.['']) {
    json.packages[''].version = version;
  }

  writeJson(filePath, json);
}

console.log(`Synchronized project version to ${version}`);

import path from 'node:path';
import { spawn } from 'node:child_process';
import { removePath } from './fs-utils.mjs';

const target = process.argv[2];

if (!['chrome', 'firefox'].includes(target)) {
  console.error(`Unsupported browser target: ${target || '(missing)'}`);
  process.exit(1);
}

const rootDir = process.cwd();
const outDir = path.resolve(rootDir, 'dist', target);
const viteBin = path.resolve(rootDir, 'node_modules', 'vite', 'bin', 'vite.js');
const tscBin = path.resolve(rootDir, 'node_modules', 'typescript', 'bin', 'tsc');
const buildBackgroundScript = path.resolve(rootDir, 'scripts', 'build-background.mjs');
const buildContentScripts = path.resolve(rootDir, 'scripts', 'build-content-scripts.mjs');
const buildSandboxScript = path.resolve(rootDir, 'scripts', 'build-sandbox.mjs');
const copyStaticScript = path.resolve(rootDir, 'scripts', 'copy-static.mjs');

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
      cwd: rootDir,
      stdio: 'inherit'
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${path.basename(scriptPath)} exited with code ${code}`));
    });
  });
}

removePath(outDir);

await runNodeScript(viteBin, ['build', '--outDir', outDir]);
await runNodeScript(tscBin, ['-p', 'tsconfig.runtime.json', '--outDir', outDir]);
await runNodeScript(buildContentScripts, [outDir]);
await runNodeScript(buildBackgroundScript, [outDir]);
await runNodeScript(buildSandboxScript, [outDir]);
await runNodeScript(copyStaticScript, [target, outDir]);

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { removePath } from "./fs-utils.mjs";

const target = String(process.argv[2] || "").trim();
const supportedTargets = new Set(["chrome", "firefox"]);

if (!supportedTargets.has(target)) {
  console.error(`Usage: node scripts/package-release.mjs <chrome|firefox>`);
  process.exit(1);
}

const rootDir = process.cwd();
const distDir = path.resolve(rootDir, "dist", target);
const releaseDir = path.resolve(rootDir, "release");
const versionFile = path.resolve(rootDir, "version.json");
const versionJson = JSON.parse(readFileSync(versionFile, "utf8"));
const version = String(versionJson?.version || "").trim();

if (!version) {
  console.error(`version.json must contain a non-empty "version" string.`);
  process.exit(1);
}

if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
  console.error(`Build output not found: ${distDir}`);
  console.error(`Run the build first, for example: npm run build:${target}`);
  process.exit(1);
}

const folderName = `chat-plus-v${version}-${target}`;
const stagedDir = path.resolve(releaseDir, folderName);
const zipPath = path.resolve(releaseDir, `${folderName}.zip`);
const checksumPath = path.resolve(releaseDir, `${folderName}.sha256.txt`);

removePath(stagedDir);
removePath(zipPath);
removePath(checksumPath);
mkdirSync(releaseDir, { recursive: true });

cpSync(distDir, stagedDir, { recursive: true, force: true });

const zipOk = process.platform === "win32"
  ? runWindowsZip(stagedDir, zipPath, releaseDir)
  : runPosixZip(stagedDir, zipPath, releaseDir);

if (!zipOk) {
  process.exit(1);
}

const hash = createHash("sha256").update(readFileSync(zipPath)).digest("hex");
const checksumLine = `${hash}  ${path.basename(zipPath)}\n`;
writeFileSync(checksumPath, checksumLine, "utf8");
console.log(`Packaged ${target} release: ${zipPath}`);
console.log(`Checksum written: ${checksumPath}`);

function runWindowsZip(sourceDir, destinationZip, workingDir) {
  const result = spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Compress-Archive -Path '${escapeForPowerShell(path.basename(sourceDir))}' -DestinationPath '${escapeForPowerShell(destinationZip)}' -Force`,
    ],
    {
      cwd: workingDir,
      stdio: "inherit",
    },
  );

  if (result.status === 0) {
    return true;
  }

  console.error(`Failed to create zip with PowerShell for ${sourceDir}`);
  return false;
}

function runPosixZip(sourceDir, destinationZip, workingDir) {
  const result = spawnSync(
    "zip",
    ["-qr", destinationZip, path.basename(sourceDir)],
    {
      cwd: workingDir,
      stdio: "inherit",
    },
  );

  if (result.status === 0) {
    return true;
  }

  console.error(`Failed to create zip with zip CLI for ${sourceDir}`);
  return false;
}

function escapeForPowerShell(value) {
  return String(value).replace(/'/g, "''");
}

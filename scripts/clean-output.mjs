import path from "node:path";

import { removePath } from "./fs-utils.mjs";

const targetArg = String(process.argv[2] || "").trim();

if (!targetArg) {
  console.error("Usage: node scripts/clean-output.mjs <path>");
  process.exit(1);
}

const rootDir = process.cwd();
const targetPath = path.resolve(rootDir, targetArg);

removePath(targetPath);

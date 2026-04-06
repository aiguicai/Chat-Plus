import path from "node:path";
import { build, context } from "esbuild";

const outDir = process.argv[2];
const watch = process.argv.includes("--watch");

if (!outDir) {
  console.error("Missing output directory for background build.");
  process.exit(1);
}

const rootDir = process.cwd();
const outfile = path.resolve(rootDir, outDir, "background", "background.js");

const options = {
  entryPoints: [path.resolve(rootDir, "src/background/background.ts")],
  bundle: true,
  format: "iife",
  platform: "browser",
  target: ["chrome120", "firefox128"],
  outfile,
  sourcemap: true,
  legalComments: "none",
};

if (watch) {
  const buildContext = await context(options);
  await buildContext.watch();
  console.log(`[build-background] watching ${outfile}`);
  await new Promise(() => {});
} else {
  await build(options);
}

import { spawnSync } from "node:child_process";

const categories = [
  { key: "feat", title: "Features" },
  { key: "fix", title: "Fixes" },
  { key: "perf", title: "Performance" },
  { key: "refactor", title: "Refactors" },
  { key: "docs", title: "Documentation" },
  { key: "test", title: "Tests" },
  { key: "build", title: "Build" },
  { key: "ci", title: "CI" },
  { key: "style", title: "Style" },
  { key: "revert", title: "Reverts" },
  { key: "chore", title: "Chores" },
  { key: "other", title: "Other Changes" },
];

const currentTag = String(process.argv[2] || process.env.GITHUB_REF_NAME || "").trim();

if (!currentTag) {
  console.error("Usage: node scripts/generate-release-notes.mjs <tag>");
  process.exit(1);
}

const repoUrl = normalizeRepoUrl(runGit(["remote", "get-url", "origin"], { allowFailure: true }).stdout.trim());
const previousTag = findPreviousTag(currentTag);
const commits = readCommits(previousTag, currentTag);

const grouped = new Map(categories.map((category) => [category.key, []]));

for (const commit of commits) {
  grouped.get(commit.type)?.push(commit);
}

const lines = [`## ${currentTag}`, ""];

if (previousTag) {
  lines.push(`Changes since \`${previousTag}\`.`, "");
} else {
  lines.push("Initial release.", "");
}

if (commits.length === 0) {
  lines.push("- No commits were found for this release.");
} else {
  for (const category of categories) {
    const items = grouped.get(category.key);
    if (!items?.length) {
      continue;
    }

    lines.push(`### ${category.title}`, "");
    for (const commit of items) {
      lines.push(`- ${formatCommitLine(commit, repoUrl)}`);
    }
    lines.push("");
  }
}

if (previousTag && repoUrl) {
  lines.push(`**Full Changelog**: ${repoUrl}/compare/${previousTag}...${currentTag}`);
}

process.stdout.write(`${lines.join("\n").trimEnd()}\n`);

function findPreviousTag(tag) {
  const result = runGit(["describe", "--tags", "--abbrev=0", `${tag}^`], { allowFailure: true });
  return result.status === 0 ? result.stdout.trim() : "";
}

function readCommits(previousTagName, currentTagName) {
  const range = previousTagName ? `${previousTagName}..${currentTagName}` : currentTagName;
  const result = runGit(
    ["log", range, "--pretty=format:%H%x1f%s%x1e"],
    { allowFailure: true },
  );

  if (result.status !== 0 || !result.stdout.trim()) {
    return [];
  }

  return result.stdout
    .split("\x1e")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [sha = "", subject = ""] = entry.split("\x1f");
      return parseCommit(sha.trim(), subject.trim());
    });
}

function parseCommit(sha, subject) {
  const match = subject.match(/^([a-z]+)(?:\(([^)]+)\))?(!)?:\s+(.+)$/i);

  if (!match) {
    return {
      sha,
      scope: "",
      subject,
      type: "other",
    };
  }

  const [, rawType, rawScope = "", breaking = "", summary = ""] = match;
  const type = normalizeType(rawType);
  const scope = rawScope.trim();
  const cleanSummary = summary.trim();

  return {
    sha,
    scope,
    subject: breaking ? `${cleanSummary} (breaking)` : cleanSummary,
    type,
  };
}

function normalizeType(rawType) {
  const type = String(rawType || "").toLowerCase();
  return categories.some((category) => category.key === type) ? type : "other";
}

function formatCommitLine(commit, repoUrlValue) {
  const scopePrefix = commit.scope ? `**${commit.scope}:** ` : "";
  const shaShort = commit.sha.slice(0, 7);

  if (!repoUrlValue || !shaShort) {
    return `${scopePrefix}${commit.subject}`;
  }

  return `${scopePrefix}${commit.subject} ([\`${shaShort}\`](${repoUrlValue}/commit/${commit.sha}))`;
}

function normalizeRepoUrl(value) {
  if (!value) {
    return "";
  }

  if (value.startsWith("git@github.com:")) {
    return `https://github.com/${value.slice("git@github.com:".length).replace(/\.git$/, "")}`;
  }

  if (value.startsWith("https://github.com/") || value.startsWith("http://github.com/")) {
    return value.replace(/\.git$/, "").replace(/^http:\/\//, "https://");
  }

  return "";
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (!options.allowFailure && result.status !== 0) {
    const detail = result.stderr?.trim() || result.stdout?.trim() || `git ${args.join(" ")}`;
    throw new Error(detail);
  }

  return result;
}

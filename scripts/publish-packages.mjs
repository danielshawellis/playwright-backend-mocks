#!/usr/bin/env node
/**
 * Publish each public package under packages/ whose version is not yet on npm.
 * Skips already-published versions so merges to main that do not bump versions
 * are no-ops. Publishes in dependency order so workspace:* rewrites resolve.
 */
import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const packagesRoot = fileURLToPath(new URL("../packages/", import.meta.url));

/** Preferred publish order (dependents after dependencies). */
const PREFERRED_ORDER = ["protocol", "node", "proxy", "playwright", "dashboard"];

function readPackageJson(dirName) {
  return JSON.parse(readFileSync(join(packagesRoot, dirName, "package.json"), "utf8"));
}

function assertBuilt(dirName, pkg) {
  const files = Array.isArray(pkg.files) ? pkg.files : [];
  if (!files.includes("dist")) {
    return;
  }
  const distDir = join(packagesRoot, dirName, "dist");
  if (!existsSync(distDir) || readdirSync(distDir).length === 0) {
    throw new Error(
      `packages/${dirName}/dist is missing or empty. Run \`pnpm build\` before publishing.`,
    );
  }
}

function isPublished(name, version) {
  try {
    execSync(`npm view ${name}@${version} version`, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function publishPackage(name) {
  execSync(
    `pnpm --filter ${JSON.stringify(name)} publish --access public --no-git-checks`,
    {
      stdio: "inherit",
    },
  );
}

const dirs = readdirSync(packagesRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);

const ordered = [
  ...PREFERRED_ORDER.filter((name) => dirs.includes(name)),
  ...dirs.filter((name) => !PREFERRED_ORDER.includes(name)).sort(),
];

let publishedCount = 0;
let skippedCount = 0;

for (const dir of ordered) {
  const pkg = readPackageJson(dir);
  if (pkg.private === true) {
    console.log(`Skipping ${dir} (private)`);
    skippedCount += 1;
    continue;
  }

  const { name, version } = pkg;
  if (typeof name !== "string" || typeof version !== "string") {
    throw new Error(`Invalid package.json in packages/${dir}`);
  }

  if (isPublished(name, version)) {
    console.log(`Skipping ${name}@${version} (already on npm)`);
    skippedCount += 1;
    continue;
  }

  assertBuilt(dir, pkg);
  console.log(`Publishing ${name}@${version}...`);
  publishPackage(name);
  publishedCount += 1;
}

console.log(`Done. Published ${publishedCount}, skipped ${skippedCount}.`);

#!/usr/bin/env node
/**
 * Copy examples/getting-started into packages/create/template and rewrite
 * workspace:* dependency ranges to this package's published version.
 */
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const createRoot = fileURLToPath(new URL("..", import.meta.url));
const exampleRoot = fileURLToPath(
  new URL("../../../examples/getting-started", import.meta.url),
);
const templateRoot = join(createRoot, "template");
const pkg = JSON.parse(readFileSync(join(createRoot, "package.json"), "utf8"));

const SKIP_DIRS = new Set(["node_modules", "test-results", "playwright-report", "dist"]);

function copyDir(from, to) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) {
      continue;
    }
    const source = join(from, entry.name);
    const target = join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(source, target);
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    cpSync(source, target);
  }
}

if (!existsSync(join(exampleRoot, "package.json"))) {
  throw new Error(`Missing example at ${exampleRoot}`);
}

rmSync(templateRoot, { recursive: true, force: true });
copyDir(exampleRoot, templateRoot);

const packageJsonPath = join(templateRoot, "package.json");
const examplePkg = JSON.parse(readFileSync(packageJsonPath, "utf8"));
examplePkg.name = "playwright-backend-mocks-getting-started";
delete examplePkg.private;

for (const key of ["dependencies", "devDependencies"]) {
  const deps = examplePkg[key];
  if (!deps) continue;
  for (const [name, version] of Object.entries(deps)) {
    if (version === "workspace:*" && name.startsWith("@playwright-backend-mocks/")) {
      deps[name] = pkg.version;
    }
  }
}

writeFileSync(packageJsonPath, `${JSON.stringify(examplePkg, null, 2)}\n`);
console.log(`Synced template → ${templateRoot} (@ ${pkg.version})`);

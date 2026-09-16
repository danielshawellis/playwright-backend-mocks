import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(__dirname, "..");
const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

type CliOptions = {
  rootDir: string;
  quiet: boolean;
  installDeps: boolean;
  installBrowsers: boolean;
  force: boolean;
};

function printHelp(): void {
  console.log(`Usage: npm create @playwright-backend-mocks@latest [rootDir] [options]

Scaffold the Playwright Backend Mocks getting-started example.

Arguments:
  rootDir                   Target directory (default: .)

Options:
  --quiet                   Skip prompts; use defaults
  --no-deps                 Do not install npm dependencies
  --no-browsers             Do not download Playwright browsers
  --force                   Allow scaffolding into a directory that already has package.json
  -h, --help                Show help
`);
}

function parseArgs(argv: string[]): CliOptions {
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const flags = new Set(argv.filter((arg) => arg.startsWith("-")));
  const positionals = argv.filter((arg) => !arg.startsWith("-"));
  const rootDir = positionals[0] ?? ".";

  return {
    rootDir,
    quiet: flags.has("--quiet"),
    installDeps: !flags.has("--no-deps"),
    installBrowsers: !flags.has("--no-browsers"),
    force: flags.has("--force"),
  };
}

async function promptYesNo(
  question: string,
  initial: boolean,
  quiet: boolean,
): Promise<boolean> {
  if (quiet || !input.isTTY || !output.isTTY) {
    return initial;
  }

  const rl = createInterface({ input, output });
  try {
    const suffix = initial ? "Y/n" : "y/N";
    const answer = (await rl.question(`${question} (${suffix}) `)).trim().toLowerCase();
    if (answer === "") {
      return initial;
    }
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

function templateRoot(): string {
  const published = join(packageRoot, "template");
  if (existsSync(join(published, "package.json"))) {
    return published;
  }

  const monorepoExample = resolve(packageRoot, "../../examples/getting-started");
  if (existsSync(join(monorepoExample, "package.json"))) {
    return monorepoExample;
  }

  throw new Error(
    "Could not find the getting-started template. Reinstall @playwright-backend-mocks/create or build it from the monorepo.",
  );
}

function listFiles(dir: string, base = dir): string[] {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const absolute = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name === "node_modules" ||
        entry.name === "test-results" ||
        entry.name === "playwright-report" ||
        entry.name === "dist"
      ) {
        continue;
      }
      files.push(...listFiles(absolute, base));
      continue;
    }
    files.push(absolute.slice(base.length + 1));
  }
  return files;
}

function rewritePackageJson(targetDir: string, projectName: string): void {
  const packageJsonPath = join(targetDir, "package.json");
  const raw = JSON.parse(readFileSync(packageJsonPath, "utf8")) as Record<
    string,
    unknown
  >;

  raw.name = projectName;
  delete raw.private;

  const rewriteDeps = (deps: unknown) => {
    if (deps === null || typeof deps !== "object") {
      return deps;
    }
    const next: Record<string, string> = {};
    for (const [name, version] of Object.entries(deps as Record<string, string>)) {
      next[name] =
        version === "workspace:*" && name.startsWith("@playwright-backend-mocks/")
          ? pkg.version
          : version;
    }
    return next;
  };

  if ("dependencies" in raw) {
    raw.dependencies = rewriteDeps(raw.dependencies);
  }
  if ("devDependencies" in raw) {
    raw.devDependencies = rewriteDeps(raw.devDependencies);
  }

  writeFileSync(packageJsonPath, `${JSON.stringify(raw, null, 2)}\n`);
}

function detectPackageManager(): "npm" | "pnpm" | "yarn" {
  const userAgent = process.env.npm_config_user_agent ?? "";
  if (userAgent.includes("pnpm")) {
    return "pnpm";
  }
  if (userAgent.includes("yarn")) {
    return "yarn";
  }
  return "npm";
}

function run(command: string, args: string[], cwd: string): void {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", shell: false });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${command} ${args.join(" ")}`);
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const targetDir = resolve(process.cwd(), options.rootDir);
  const projectName =
    options.rootDir === "."
      ? "playwright-backend-mocks-getting-started"
      : (options.rootDir.replace(/\\/g, "/").split("/").filter(Boolean).at(-1) ??
        "playwright-backend-mocks-getting-started");

  if (existsSync(join(targetDir, "package.json")) && !options.force) {
    console.error(
      `Refusing to scaffold into ${targetDir} because package.json already exists.\n` +
        `Pass a new folder name, for example:\n` +
        `  npm create @playwright-backend-mocks@latest getting-started-demo\n` +
        `Or re-run with --force.`,
    );
    process.exit(1);
  }

  const installDeps = await promptYesNo(
    "Install npm dependencies?",
    options.installDeps,
    options.quiet,
  );
  const installBrowsers = await promptYesNo(
    "Install Playwright browsers (Chromium)?",
    options.installBrowsers,
    options.quiet,
  );

  const source = templateRoot();
  mkdirSync(targetDir, { recursive: true });

  for (const relative of listFiles(source)) {
    if (relative === "README.md") {
      // Keep a shorter generated README for scaffolded copies.
      continue;
    }
    const from = join(source, relative);
    const to = join(targetDir, relative);
    mkdirSync(dirname(to), { recursive: true });
    cpSync(from, to);
  }

  rewritePackageJson(targetDir, projectName);

  writeFileSync(
    join(targetDir, "README.md"),
    `# ${projectName}

Scaffolded with \`@playwright-backend-mocks/create\`. The sample is already wired
(proxy, Node agent, Playwright fixture, and one declined-card test).

\`\`\`bash
npx playwright test
\`\`\`

Then read the getting started guide to see how each piece fits:
https://danielshawellis.github.io/playwright-backend-mocks/guide/getting-started
`,
  );

  const pm = detectPackageManager();
  console.log(`\nInitialized project in '${targetDir}'`);

  if (installDeps) {
    if (pm === "pnpm") {
      run("pnpm", ["install"], targetDir);
    } else if (pm === "yarn") {
      run("yarn", [], targetDir);
    } else {
      run("npm", ["install"], targetDir);
    }
  }

  if (installBrowsers) {
    if (pm === "pnpm") {
      run("pnpm", ["exec", "playwright", "install", "chromium"], targetDir);
    } else if (pm === "yarn") {
      run("yarn", ["playwright", "install", "chromium"], targetDir);
    } else {
      run("npx", ["playwright", "install", "chromium"], targetDir);
    }
  }

  const rel = options.rootDir === "." ? "." : options.rootDir;
  console.log(`
✔ Success! Created a Playwright Backend Mocks example at ${targetDir}

The sample is already wired. Confirm it works:

  cd ${rel}
  npx playwright test

Then read the getting started guide — steps 1–4 match the files in this folder:
https://danielshawellis.github.io/playwright-backend-mocks/guide/getting-started
`);
}

main().catch((error: unknown) => {
  console.error(
    "[@playwright-backend-mocks/create] failed:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});

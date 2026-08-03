import { createProxyServer } from "./server.js";
import type { LogLevel } from "./config.js";

function printHelp(): void {
  console.log(`Usage: playwright-backend-mocks-proxy [options]

Options:
  --host <host>              Bind host (default: 127.0.0.1)
  --port <port>              Bind port (default: 4310)
  --token <token>            Optional shared connection token
  --history-limit <n>        In-memory history size (default: 1000)
  --heartbeat-ms <ms>        Ping interval (default: 15000)
  --idle-timeout-ms <ms>     Idle disconnect timeout (default: 60000)
  --claim-timeout-ms <ms>    Wait for Playwright route claims (default: 5000)
  --log-level <level>        silent|error|warn|info|debug (default: info)
  -h, --help                 Show help
`);
}

function readFlag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  return args[index + 1];
}

function parseArgs(argv: string[]) {
  if (argv.includes("-h") || argv.includes("--help")) {
    printHelp();
    process.exit(0);
  }

  const host = readFlag(argv, "--host") ?? "127.0.0.1";
  const portRaw = readFlag(argv, "--port") ?? "4310";
  const port = Number(portRaw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid --port: ${portRaw}`);
  }

  const historyLimitRaw = readFlag(argv, "--history-limit") ?? "1000";
  const historyLimit = Number(historyLimitRaw);
  if (!Number.isInteger(historyLimit) || historyLimit <= 0) {
    throw new Error(`Invalid --history-limit: ${historyLimitRaw}`);
  }

  const heartbeatRaw = readFlag(argv, "--heartbeat-ms") ?? "15000";
  const heartbeatMs = Number(heartbeatRaw);
  if (!Number.isInteger(heartbeatMs) || heartbeatMs <= 0) {
    throw new Error(`Invalid --heartbeat-ms: ${heartbeatRaw}`);
  }

  const idleRaw = readFlag(argv, "--idle-timeout-ms") ?? "60000";
  const idleTimeoutMs = Number(idleRaw);
  if (!Number.isInteger(idleTimeoutMs) || idleTimeoutMs <= 0) {
    throw new Error(`Invalid --idle-timeout-ms: ${idleRaw}`);
  }

  const claimRaw = readFlag(argv, "--claim-timeout-ms") ?? "5000";
  const claimTimeoutMs = Number(claimRaw);
  if (!Number.isInteger(claimTimeoutMs) || claimTimeoutMs <= 0) {
    throw new Error(`Invalid --claim-timeout-ms: ${claimRaw}`);
  }

  const logLevel = (readFlag(argv, "--log-level") ?? "info") as LogLevel;
  const allowed: LogLevel[] = ["silent", "error", "warn", "info", "debug"];
  if (!allowed.includes(logLevel)) {
    throw new Error(`Invalid --log-level: ${logLevel}`);
  }

  const token = readFlag(argv, "--token");

  return {
    host,
    port,
    historyLimit,
    heartbeatMs,
    idleTimeoutMs,
    claimTimeoutMs,
    logLevel,
    ...(token !== undefined ? { token } : {}),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const server = createProxyServer(options);

  const shutdown = async (signal: string) => {
    console.log(`[playwright-backend-mocks-proxy] shutting down (${signal})`);
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await server.start();
}

main().catch((error: unknown) => {
  console.error(
    "[playwright-backend-mocks-proxy] failed to start:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});

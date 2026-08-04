import type { LogLevel } from "./config.js";

const LEVEL_ORDER: Record<LogLevel, number> = {
  silent: 100,
  error: 40,
  warn: 30,
  info: 20,
  debug: 10,
};

export class Logger {
  constructor(private readonly level: LogLevel) {}

  error(...args: unknown[]): void {
    this.write("error", args);
  }

  warn(...args: unknown[]): void {
    this.write("warn", args);
  }

  info(...args: unknown[]): void {
    this.write("info", args);
  }

  debug(...args: unknown[]): void {
    this.write("debug", args);
  }

  private write(level: LogLevel, args: unknown[]): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) {
      return;
    }
    const prefix = `[playwright-backend-mocks-proxy] ${level}`;
    if (level === "error") {
      console.error(prefix, ...args);
    } else if (level === "warn") {
      console.warn(prefix, ...args);
    } else {
      console.log(prefix, ...args);
    }
  }
}

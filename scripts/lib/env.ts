import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Reads a variable from the environment, falling back to .env.local in the project root (never printed). */
export function envVar(name: string): string | undefined {
  if (process.env[name]) return process.env[name];
  const file = join(__dirname, "..", "..", ".env.local");
  if (!existsSync(file)) return undefined;
  const m = readFileSync(file, "utf8").match(new RegExp(`^${name}=(.*)$`, "m"));
  return m?.[1]?.trim().replace(/^'(.*)'$|^"(.*)"$/, "$1$2") || undefined;
}

/** `--name value` command-line options; repeated options are collected by `args`. */
export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && i + 1 < process.argv.length ? process.argv[i + 1] : fallback;
}

export function args(name: string): string[] {
  const out: string[] = [];
  process.argv.forEach((a, i) => a === `--${name}` && i + 1 < process.argv.length && out.push(process.argv[i + 1]));
  return out;
}

export const flag = (name: string) => process.argv.includes(`--${name}`);

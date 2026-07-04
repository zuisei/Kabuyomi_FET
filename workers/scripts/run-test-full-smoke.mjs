import { existsSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);

try {
  const devVars = readDevVars(join(rootDir, ".dev.vars"));
  const env = { ...process.env, ...devVars };

  requireSecret(env, "CLOUDFLARE_API_TOKEN");
  requireSecret(env, "OPENAI_API_KEY");

  run("npm", ["run", "deploy:test"], env);
  run("npm", ["run", "testbench:full-smoke", "--", "--check-only"], env);
  run("npm", ["run", "testbench:full-smoke"], {
    ...env,
    KABUYOMI_TESTBENCH_RUN_ID: env.KABUYOMI_TESTBENCH_RUN_ID?.trim() || "2026-07-02-prompt-v2-full-smoke-r1"
  });
} catch (error) {
  console.error(`[live-full-smoke] ${error.message}`);
  process.exit(1);
}

function run(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: rootDir,
    env,
    stdio: "inherit"
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function requireSecret(env, name) {
  if (!env[name]?.trim()) {
    throw new Error(`${name} is missing. Run npm run secrets:test:setup first.`);
  }
}

function readDevVars(path) {
  if (!existsSync(path)) {
    return {};
  }
  const values = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!match) {
      continue;
    }
    values[match[1]] = parseDevVarValue(match[2]);
  }
  return values;
}

function parseDevVarValue(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  return trimmed;
}

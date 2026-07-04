import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, resolve } from "node:path";

const rootDir = resolve(new URL("..", import.meta.url).pathname);
const targetPath = join(rootDir, ".dev.vars");

try {
  const openaiKey = await resolveSecret("OPENAI_API_KEY", "OpenAI API key");
  const cloudflareToken = await resolveSecret("CLOUDFLARE_API_TOKEN", "Cloudflare API token");

  upsertDevVars(targetPath, {
    OPENAI_API_KEY: openaiKey,
    CLOUDFLARE_API_TOKEN: cloudflareToken
  });

  console.log(`[secrets] wrote OPENAI_API_KEY and CLOUDFLARE_API_TOKEN to ${targetPath}`);
  console.log("[secrets] uploading OPENAI_API_KEY to the test Worker secret store...");

  const secretResult = spawnSync("npx", ["wrangler", "secret", "put", "OPENAI_API_KEY", "--config", "wrangler.test.toml"], {
    cwd: rootDir,
    env: { ...process.env, CLOUDFLARE_API_TOKEN: cloudflareToken },
    input: `${openaiKey}\n`,
    stdio: ["pipe", "inherit", "inherit"]
  });

  if (secretResult.status !== 0) {
    process.exit(secretResult.status ?? 1);
  }

  console.log("[secrets] test Worker OPENAI_API_KEY secret is set.");
} catch (error) {
  console.error(`[secrets] ${error.message}`);
  process.exit(1);
}

async function resolveSecret(envName, label) {
  const existing = process.env[envName]?.trim();
  if (existing) {
    return existing;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error(`${envName} is missing. Run interactively or pass it as an environment variable.`);
  }
  const value = await promptHidden(`${label}: `);
  if (!value.trim()) {
    throw new Error(`${envName} cannot be empty.`);
  }
  return value.trim();
}

function upsertDevVars(path, entries) {
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const blockedNames = new Set(Object.keys(entries));
  const lines = existing
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .filter((line) => {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return !match || !blockedNames.has(match[1]);
    });

  for (const [name, value] of Object.entries(entries)) {
    lines.push(`${name}=${escapeDevVar(value)}`);
  }

  writeFileSync(path, `${lines.join("\n")}\n`, { mode: 0o600 });
  chmodSync(path, 0o600);
}

function escapeDevVar(value) {
  if (/^[^\s"'#\\]+$/.test(value)) {
    return value;
  }
  return JSON.stringify(value);
}

function promptHidden(prompt) {
  return new Promise((resolveValue) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    let value = "";

    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    const onData = (chunk) => {
      for (const char of chunk) {
        if (char === "\u0003") {
          stdout.write("\n");
          process.exit(130);
        }
        if (char === "\r" || char === "\n") {
          stdin.setRawMode(false);
          stdin.pause();
          stdin.off("data", onData);
          stdout.write("\n");
          resolveValue(value);
          return;
        }
        if (char === "\u007f" || char === "\b") {
          value = value.slice(0, -1);
          continue;
        }
        value += char;
      }
    };

    stdin.on("data", onData);
  });
}

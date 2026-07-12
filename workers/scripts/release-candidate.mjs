import { createHash } from "node:crypto";
import { lstat, readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const RELEASE_CANDIDATE_FORMAT = "kabuyomi-worker-release-candidate-v1";
export const RELEASE_CANDIDATE_ID_PATTERN = /^[a-f0-9]{64}$/u;

const defaultWorkersDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const REQUIRED_FILES = Object.freeze([
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "wrangler.toml",
  "wrangler.test.toml"
]);

const REQUIRED_TREES = Object.freeze([
  "src",
  "d1/migrations",
  "../shared"
]);

/**
 * Hash every input that can change the Worker bundle, runtime bindings, or D1
 * schema. The allowlist deliberately excludes credentials, local environment
 * files, generated bundles, test evidence, and benchmark runs.
 */
export async function computeReleaseCandidate(options = {}) {
  const workersDir = resolve(options.workersDir ?? defaultWorkersDir);
  const files = await collectReleaseCandidateFiles(workersDir);
  const candidate = createHash("sha256");
  candidate.update(`${RELEASE_CANDIDATE_FORMAT}\0`, "utf8");
  const entries = [];

  for (const file of files) {
    const contents = await readFile(file.absolutePath);
    const pathBytes = Buffer.byteLength(file.path, "utf8");
    candidate.update(`${pathBytes}:${file.path}\0${contents.byteLength}:`, "utf8");
    candidate.update(contents);
    candidate.update("\0", "utf8");
    entries.push({
      path: file.path,
      bytes: contents.byteLength,
      sha256: createHash("sha256").update(contents).digest("hex")
    });
  }

  return {
    version: RELEASE_CANDIDATE_FORMAT,
    releaseCandidateId: candidate.digest("hex"),
    files: entries
  };
}

export async function collectReleaseCandidateFiles(workersDir = defaultWorkersDir) {
  const root = resolve(workersDir, "..");
  const absoluteWorkersDir = resolve(workersDir);
  const files = [];

  for (const path of REQUIRED_FILES) {
    const absolutePath = resolve(absoluteWorkersDir, path);
    await assertRegularFile(absolutePath, path);
    files.push(toCandidateFile(root, absolutePath));
  }

  for (const tree of REQUIRED_TREES) {
    const absoluteTree = resolve(absoluteWorkersDir, tree);
    const treeFiles = await walkRegularFiles(absoluteTree);
    if (treeFiles.length === 0) {
      throw new Error(`release_candidate_tree_empty:${tree}`);
    }
    files.push(...treeFiles.map((absolutePath) => toCandidateFile(root, absolutePath)));
  }

  const byPath = new Map();
  for (const file of files) {
    if (byPath.has(file.path)) {
      throw new Error(`release_candidate_duplicate_path:${file.path}`);
    }
    byPath.set(file.path, file);
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path, "en"));
}

export function assertReleaseCandidateId(value, label = "releaseCandidateId") {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!RELEASE_CANDIDATE_ID_PATTERN.test(normalized)) {
    throw new Error(`${label}_must_be_sha256`);
  }
  return normalized;
}

async function walkRegularFiles(directory) {
  const stat = await lstat(directory).catch(() => null);
  if (!stat?.isDirectory()) {
    throw new Error(`release_candidate_tree_missing:${directory}`);
  }
  const files = [];
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name, "en"))) {
    if (entry.name.startsWith(".")) continue;
    const path = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`release_candidate_symlink_forbidden:${path}`);
    }
    if (entry.isDirectory()) {
      files.push(...await walkRegularFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    } else {
      throw new Error(`release_candidate_special_file_forbidden:${path}`);
    }
  }
  return files;
}

async function assertRegularFile(path, label) {
  const stat = await lstat(path).catch(() => null);
  if (!stat?.isFile() || stat.isSymbolicLink()) {
    throw new Error(`release_candidate_required_file_missing:${label}`);
  }
}

function toCandidateFile(root, absolutePath) {
  const relativePath = relative(root, absolutePath);
  if (!relativePath || relativePath === ".." || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`release_candidate_path_outside_repository:${absolutePath}`);
  }
  return {
    absolutePath,
    path: relativePath.split(sep).join("/")
  };
}

async function main() {
  const args = process.argv.slice(2);
  const candidate = await computeReleaseCandidate();
  const checkIndex = args.indexOf("--check");
  if (checkIndex >= 0) {
    const expected = assertReleaseCandidateId(args[checkIndex + 1], "expected_release_candidate_id");
    if (candidate.releaseCandidateId !== expected) {
      throw new Error(`release_candidate_mismatch:expected=${expected}:actual=${candidate.releaseCandidateId}`);
    }
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(candidate, null, 2)}\n`);
  } else {
    process.stdout.write(`${candidate.releaseCandidateId}\n`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

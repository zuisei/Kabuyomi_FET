import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const MIGRATION_FILE_PATTERN = /^(\d{4})_([a-z0-9]+(?:_[a-z0-9]+)*)\.sql$/;
const migrationsDirectory = resolve(import.meta.dirname, "../d1/migrations");

export function validateMigrationFiles(entries, readContents) {
  const errors = [];
  const sqlEntries = entries.filter((entry) => entry.endsWith(".sql")).sort();

  if (sqlEntries.length === 0) {
    errors.push("no .sql migration files were found");
    return { errors, migrations: [] };
  }

  const migrations = sqlEntries.map((entry) => {
    const match = entry.match(MIGRATION_FILE_PATTERN);
    if (!match) {
      errors.push(`${entry}: expected NNNN_lowercase_description.sql`);
      return { entry, sequence: null };
    }
    return { entry, sequence: Number.parseInt(match[1], 10) };
  });

  const validMigrations = migrations.filter((migration) => migration.sequence !== null);
  for (let index = 0; index < validMigrations.length; index += 1) {
    const migration = validMigrations[index];
    const expected = index + 1;
    if (migration.sequence !== expected) {
      errors.push(`${migration.entry}: expected sequence ${String(expected).padStart(4, "0")}`);
    }
    const contents = readContents(migration.entry);
    if (!contents.trim()) {
      errors.push(`${migration.entry}: migration file is empty`);
    }
  }

  return { errors, migrations: validMigrations };
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const result = validateMigrationFiles(readdirSync(migrationsDirectory), (entry) =>
    readFileSync(join(migrationsDirectory, entry), "utf8")
  );

  if (result.errors.length > 0) {
    console.error("[migrations] validation failed:");
    for (const error of result.errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  const first = result.migrations.at(0)?.entry.slice(0, 4);
  const last = result.migrations.at(-1)?.entry.slice(0, 4);
  console.log(`[migrations] validated ${result.migrations.length} ordered migrations (${first}-${last}).`);
}

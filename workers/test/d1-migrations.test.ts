import { describe, expect, it } from "vitest";

// @ts-ignore Repository validation helper is an ESM script executed by Node.
const { validateMigrationFiles } = await import("../scripts/validate-d1-migrations.mjs");

describe("D1 migration ordering", () => {
  it("accepts contiguous, lowercase migration names with non-empty SQL", () => {
    const result = validateMigrationFiles(
      ["0002_add_index.sql", "README.md", "0001_create_table.sql"],
      () => "SELECT 1;"
    );

    expect(result.errors).toEqual([]);
    expect(result.migrations.map((migration: { entry: string }) => migration.entry)).toEqual([
      "0001_create_table.sql",
      "0002_add_index.sql"
    ]);
  });

  it("rejects malformed names, gaps, and empty migrations", () => {
    const result = validateMigrationFiles(
      ["0001_create_table.sql", "0003_Gap.sql", "0004_empty.sql"],
      (entry: string) => (entry === "0004_empty.sql" ? "" : "SELECT 1;")
    );

    expect(result.errors).toEqual(
      expect.arrayContaining([
        "0003_Gap.sql: expected NNNN_lowercase_description.sql",
        "0004_empty.sql: expected sequence 0002",
        "0004_empty.sql: migration file is empty"
      ])
    );
  });
});

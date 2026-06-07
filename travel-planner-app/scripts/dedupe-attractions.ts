import "dotenv/config";
import dotenv from "dotenv";
import path from "path";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// ── Known semantic duplicate groups ───────────────────────────────────────
//
// Each group has one keeper and one or more duplicate rows to deactivate.
// Names must match the database exactly (check with a SELECT before adding).
// The script is idempotent: safe to rerun without duplicating notes.

type DuplicateEntry = {
  name: string; // exact DB name of the row to suppress
  note: string; // text written to cleaning_notes on the deactivated row
};

type DuplicateGroup = {
  keepName: string; // exact DB name of the row to keep active
  duplicates: DuplicateEntry[];
};

const KNOWN_DUPLICATE_GROUPS: DuplicateGroup[] = [
  {
    keepName: "Vječna vatra",
    duplicates: [
      {
        name: "Vječna Vatra memorial",
        note: "Semantic duplicate of 'Vječna vatra'; deactivated by dedupe-attractions script",
      },
    ],
  },
  {
    keepName: "Tunel spasa - Kuća Kolara",
    duplicates: [
      {
        name: "Tunnel of Hope",
        note: "Semantic duplicate of 'Tunel spasa - Kuća Kolara'; deactivated by dedupe-attractions script",
      },
      {
        name: "Ulaz u Tunel Spasa iz pravca Dobrinje",
        note: "Entrance-only view of 'Tunel spasa - Kuća Kolara'; deactivated by dedupe-attractions script",
      },
    ],
  },
];

// ── Types ──────────────────────────────────────────────────────────────────

type AttractionRow = {
  id: number;
  name: string;
  is_active: boolean | null;
  source: string | null;
  source_id: string | null;
  latitude: string;
  longitude: string;
  category: string;
  image_url: string | null;
  cleaning_notes: string | null;
};

// ── Helpers ────────────────────────────────────────────────────────────────

function parseCliArgs(): { apply: boolean } {
  // Use slice(2) to skip the node and tsx/script path entries so that
  // neither of those paths can accidentally contain "--apply".
  // This also works correctly when invoked via "npm run dedupe:apply"
  // without needing the "npm run -- --apply" double-dash workaround.
  const args = new Set(process.argv.slice(2));
  return { apply: args.has("--apply") };
}

function formatRow(row: AttractionRow): string {
  const active =
    row.is_active === null ? "null (treated as active)" : String(row.is_active);
  return [
    `    id            : ${row.id}`,
    `    is_active     : ${active}`,
    `    source        : ${row.source ?? "—"}`,
    `    source_id     : ${row.source_id ?? "—"}`,
    `    coordinates   : (${row.latitude}, ${row.longitude})`,
    `    category      : ${row.category}`,
    `    image_url     : ${row.image_url ? row.image_url.slice(0, 80) + "…" : "—"}`,
    `    cleaning_notes: ${row.cleaning_notes ?? "—"}`,
  ].join("\n");
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const { apply } = parseCliArgs();

  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is missing. Check travel-planner-app/.env.local"
    );
  }

  const pool = new Pool({ connectionString: DATABASE_URL });

  const totalDuplicates = KNOWN_DUPLICATE_GROUPS.reduce(
    (sum, g) => sum + g.duplicates.length,
    0
  );

  console.log("=".repeat(60));
  console.log(
    apply ? "MODE: APPLY (writing to database)" : "MODE: DRY-RUN (no writes)"
  );
  console.log(
    `Groups: ${KNOWN_DUPLICATE_GROUPS.length}  |  Total duplicates: ${totalDuplicates}`
  );
  console.log("=".repeat(60));

  let deactivated = 0;
  let alreadyInactive = 0;
  let notFound = 0;
  let groupsSkipped = 0;

  for (const group of KNOWN_DUPLICATE_GROUPS) {
    console.log(`\n${"─".repeat(60)}`);
    console.log(`Group keeper: "${group.keepName}"`);

    // Fetch keeper + all duplicate rows in one round-trip.
    const allNames = [group.keepName, ...group.duplicates.map((d) => d.name)];
    const placeholders = allNames.map((_, i) => `$${i + 1}`).join(", ");
    const { rows } = await pool.query<AttractionRow>(
      `SELECT id, name, is_active, source, source_id,
              latitude::text, longitude::text, category, image_url, cleaning_notes
       FROM   attractions
       WHERE  name IN (${placeholders})
       ORDER BY name`,
      allNames
    );

    const byName = new Map(rows.map((r) => [r.name, r]));
    const primary = byName.get(group.keepName);

    // Safety guard: do not touch any duplicate if the keeper doesn't exist.
    if (!primary) {
      console.log(
        `\n  [KEEP] "${group.keepName}" — NOT FOUND in database.\n` +
          `  Skipping all ${group.duplicates.length} duplicate(s) in this group.`
      );
      groupsSkipped++;
      notFound += group.duplicates.length;
      continue;
    }

    console.log(`\n  [KEEP]`);
    console.log(`    name: ${primary.name}`);
    console.log(formatRow(primary));

    for (const entry of group.duplicates) {
      console.log(`\n  [DEACTIVATE] target: "${entry.name}"`);
      const duplicate = byName.get(entry.name);

      if (!duplicate) {
        console.log(`    → NOT FOUND in database. Skipping.`);
        notFound++;
        continue;
      }

      console.log(formatRow(duplicate));

      if (duplicate.is_active === false) {
        console.log(`    → Already inactive. Skipping.`);
        alreadyInactive++;
        continue;
      }

      if (!apply) {
        console.log(
          `    → DRY-RUN: would set is_active = false and append cleaning_notes.`
        );
        continue;
      }

      // Append note only when absent — idempotent if is_active is later reset externally.
      const existing = duplicate.cleaning_notes ?? "";
      const newNotes = existing.includes(entry.note)
        ? existing
        : existing
        ? `${existing}; ${entry.note}`
        : entry.note;

      await pool.query(
        `UPDATE attractions
         SET    is_active      = false,
                cleaning_notes = $1
         WHERE  id             = $2`,
        [newNotes, duplicate.id]
      );

      console.log(`    → APPLIED: is_active = false, cleaning_notes updated.`);
      deactivated++;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────────

  console.log(`\n${"=".repeat(60)}`);
  console.log("Summary:");
  console.log(`  Groups processed  : ${KNOWN_DUPLICATE_GROUPS.length}`);
  console.log(`  Groups skipped    : ${groupsSkipped} (keeper not found)`);
  console.log(`  Deactivated now   : ${deactivated}`);
  console.log(`  Already inactive  : ${alreadyInactive}`);
  console.log(`  Not found         : ${notFound}`);
  console.log(apply ? "  Database updated." : "  Dry-run — no changes made.");
  console.log("=".repeat(60));

  // ── Verification query ────────────────────────────────────────────────────

  const allVerifyNames = [
    ...new Set(
      KNOWN_DUPLICATE_GROUPS.flatMap((g) => [
        g.keepName,
        ...g.duplicates.map((d) => d.name),
      ])
    ),
  ];
  const literal = allVerifyNames
    .map((n) => `'${n.replace(/'/g, "''")}'`)
    .join(",\n    ");

  console.log(`
Run this SQL to verify the result:

  SELECT id, name, is_active, source, image_url, cleaning_notes
  FROM   attractions
  WHERE  name IN (
    ${literal}
  )
  ORDER BY name;

Expected:
  Tunel spasa - Kuća Kolara               is_active = true
  Tunnel of Hope                          is_active = false
  Ulaz u Tunel Spasa iz pravca Dobrinje   is_active = false
  Vječna vatra                            is_active = true
  Vječna Vatra memorial                   is_active = false
`);

  await pool.end();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});

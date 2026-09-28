/**
 * Bulk-import question JSON into Supabase using the service role key.
 *   NEXT_PUBLIC_SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... npm run questions:import -- my-questions.json
 *
 * Questions are validated first; nothing is written if any file has errors
 * (pass --skip-invalid to import only the valid rows). Provide an "id" (UUID)
 * on each question to make re-imports update instead of duplicate.
 */
import { existsSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";

import { validateImport } from "../src/lib/questions/import-schema";
import { toUpsertPayload } from "../src/lib/questions/upsert-payload";
import type { QuestionInput } from "../src/lib/types";
import { loadJsonFiles } from "./load-json-files";

for (const file of [".env.local", ".env"]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

const args = process.argv.slice(2);
const skipInvalid = args.includes("--skip-invalid");
const inputs = args.filter((a) => !a.startsWith("--"));
if (inputs.length === 0) {
  console.error("Usage: npm run questions:import -- <file-or-directory> [--skip-invalid]");
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  process.exit(1);
}

async function main() {
  const toImport: QuestionInput[] = [];
  let hadErrors = false;
  for (const { file, data } of loadJsonFiles(inputs)) {
    const result = validateImport(data);
    if (result.fileError) {
      console.error(`✖ ${file}: ${result.fileError}`);
      hadErrors = true;
      continue;
    }
    for (const issue of result.issues.filter((i) => i.severity === "error")) {
      console.error(`✖ ${file} #${issue.index + 1} ${issue.path}: ${issue.message}`);
      hadErrors = true;
    }
    toImport.push(...result.valid.map((v) => v.input));
  }
  if (hadErrors && !skipInvalid) {
    console.error("\nAborting: fix the errors above or pass --skip-invalid.");
    process.exit(1);
  }

  const supabase = createClient(url!, serviceKey!, { auth: { persistSession: false } });
  const batchSize = 50;
  let imported = 0;
  for (let i = 0; i < toImport.length; i += batchSize) {
    const batch = toImport.slice(i, i + batchSize).map((q) => toUpsertPayload(q));
    const { error } = await supabase.rpc("upsert_questions", { p_questions: batch });
    if (error) throw new Error(`Batch starting at ${i + 1} failed: ${error.message}`);
    imported += batch.length;
    console.log(`Imported ${imported}/${toImport.length}`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

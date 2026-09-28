/**
 * Validate question JSON files before importing them.
 *   npm run questions:validate -- data/questions my-new-questions.json
 */
import path from "node:path";

import { validateImport } from "../src/lib/questions/import-schema";
import { loadJsonFiles } from "./load-json-files";

const inputs = process.argv.slice(2);
if (inputs.length === 0) inputs.push("data/questions");

let errors = 0;
let warnings = 0;
let valid = 0;
const stems: string[] = [];

for (const { file, data } of loadJsonFiles(inputs)) {
  const result = validateImport(data, stems);
  const rel = path.relative(process.cwd(), file);
  if (result.fileError) {
    console.error(`✖ ${rel}: ${result.fileError}`);
    errors++;
    continue;
  }
  valid += result.valid.length;
  stems.push(...result.valid.map((v) => v.input.stem));
  for (const issue of result.issues) {
    const line = `  ${issue.severity === "error" ? "✖" : "⚠"} #${issue.index + 1} ${issue.path}: ${issue.message}`;
    if (issue.severity === "error") {
      errors++;
      console.error(`${rel}\n${line}`);
    } else {
      warnings++;
      console.warn(`${rel}\n${line}`);
    }
  }
  console.log(`✔ ${rel}: ${result.valid.length}/${result.total} valid`);
}

console.log(`\n${valid} valid question(s), ${errors} error(s), ${warnings} warning(s).`);
process.exit(errors > 0 ? 1 : 0);

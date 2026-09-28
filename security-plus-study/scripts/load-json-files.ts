import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

/** Read JSON files from paths (files or directories). */
export function loadJsonFiles(inputs: string[]): { file: string; data: unknown }[] {
  const files: string[] = [];
  for (const input of inputs) {
    const full = path.resolve(input);
    if (statSync(full).isDirectory()) {
      for (const name of readdirSync(full).sort()) if (name.endsWith(".json")) files.push(path.join(full, name));
    } else {
      files.push(full);
    }
  }
  return files.map((file) => ({ file, data: JSON.parse(readFileSync(file, "utf8")) as unknown }));
}

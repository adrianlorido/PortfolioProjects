/**
 * Delete the local demo-mode data store. It is recreated (with fresh demo
 * history) the next time the app starts.
 *   npm run demo:reset
 */
import { rmSync } from "node:fs";
import path from "node:path";

const dir = process.env.DEMO_DATA_DIR || path.join(process.cwd(), ".demo-data");
rmSync(dir, { recursive: true, force: true });
console.log(`Removed ${dir}. Restart the dev server to regenerate demo data.`);

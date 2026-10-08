import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const desktopRoot = resolve(here, "..");
const versionFile = resolve(desktopRoot, "../web/VERSION");
const out = resolve(desktopRoot, "src-tauri/tauri.version.conf.json");
const version = (await readFile(versionFile, "utf8")).trim();
if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.test(version)) {
  throw new Error(`web/VERSION is not valid SemVer: ${version}`);
}
await writeFile(out, JSON.stringify({ version }, null, 2) + "\n", "utf8");
console.log(`Desktop bundle version <- web/VERSION (${version})`);

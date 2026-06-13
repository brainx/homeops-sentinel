import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const forbidden = [/\/Users\//, /localhost:\d{2,5}\/Users/, /real_api_key/i, /secret_key_here/i];
const textExtensions = new Set([
  ".js",
  ".mjs",
  ".ts",
  ".tsx",
  ".css",
  ".html",
  ".json",
  ".yml",
  ".yaml",
  ".md",
  ".svg",
  ".sh",
  ".example"
]);
const ignored = new Set(["node_modules", "dist", ".git", ".npm-cache"]);

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (ignored.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(fullPath)));
    if (entry.isFile()) files.push(fullPath);
  }
  return files;
}

const files = await walk(root);
const violations = [];

for (const file of files) {
  if (path.relative(root, file) === "scripts/lint.mjs") continue;
  const ext = path.extname(file);
  if (!textExtensions.has(ext) && !file.endsWith(".env.example")) continue;
  const content = await fs.readFile(file, "utf8");
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      violations.push(`${path.relative(root, file)} matched ${pattern}`);
    }
  }
}

if (violations.length > 0) {
  console.error(violations.join("\n"));
  process.exit(1);
}

console.log(`lint ok: scanned ${files.length} project files`);

import fs from "node:fs/promises";
import path from "node:path";

const appDir = "umbrel-app-store/homeops-sentinel";
const composePath = path.join(appDir, "docker-compose.yml");
const manifestPath = path.join(appDir, "umbrel-app.yml");
const iconPath = path.join(appDir, "icon.svg");
const galleryDir = path.join(appDir, "gallery");

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const dockerfile = await fs.readFile("Dockerfile", "utf8");
const entrypoint = await fs.readFile("docker/entrypoint.sh", "utf8");
const compose = await fs.readFile(composePath, "utf8");
const manifest = await fs.readFile(manifestPath, "utf8");
const umbrelPackage = await fs.readFile("docs/UMBREL_PACKAGE.md", "utf8");
const galleryEntries = await fs.readdir(galleryDir);
const appEntries = await walk(appDir);

const failures = [];

function requireIncludes(content, needle, message) {
  if (!content.includes(needle)) failures.push(message);
}

requireIncludes(manifest, "manifestVersion: 1", "umbrel-app.yml must declare manifestVersion: 1");
requireIncludes(manifest, "id: homeops-sentinel", "umbrel-app.yml must use id homeops-sentinel");
requireIncludes(
  manifest,
  "category: networking",
  "umbrel-app.yml should keep the networking category"
);
requireIncludes(manifest, "port: 4747", "umbrel-app.yml must expose port 4747");
requireIncludes(manifest, "dependencies: []", "umbrel-app.yml must not invent dependencies");
requireIncludes(
  manifest,
  "gallery: []",
  "initial Umbrel package releases should leave gallery empty in the manifest"
);
requireIncludes(
  manifest,
  'releaseNotes: ""',
  "initial Umbrel package releases should leave releaseNotes empty"
);
requireIncludes(
  compose,
  "APP_HOST: homeops-sentinel_web_1",
  "app_proxy APP_HOST must match the app id and web service"
);
requireIncludes(compose, "APP_PORT: 4747", "app_proxy APP_PORT must match the app port");
requireIncludes(
  compose,
  "HOST: 0.0.0.0",
  "runtime container must bind inside the app proxy network"
);
requireIncludes(
  compose,
  "${APP_DATA_DIR}/data:/data",
  "persistent data must be mounted from APP_DATA_DIR"
);
requireIncludes(
  compose,
  "APP_SEED: ${APP_SEED}",
  "APP_SEED must be passed for deterministic secret encryption"
);
requireIncludes(compose, "read_only: true", "runtime container should keep read_only enabled");
requireIncludes(
  compose,
  "no-new-privileges:true",
  "runtime container should keep no-new-privileges enabled"
);
requireIncludes(
  dockerfile,
  "homeops-entrypoint",
  "Dockerfile must use the data-permission entrypoint"
);
requireIncludes(dockerfile, "su-exec", "Dockerfile must install su-exec for privilege dropping");
requireIncludes(dockerfile, "HEALTHCHECK", "Dockerfile must include a runtime healthcheck");
requireIncludes(
  entrypoint,
  "exec su-exec node",
  "entrypoint must drop privileges to the node user"
);
requireIncludes(
  entrypoint,
  "chown -R node:node",
  "entrypoint must repair mounted data-directory ownership"
);

const expectedImagePattern = new RegExp(
  `image:\\s+ghcr\\.io/[A-Za-z0-9_.-]+/homeops-sentinel-umbrel:${escapeRegExp(packageJson.version)}@sha256:[a-f0-9]{64}`
);
if (!compose.includes("@sha256:"))
  failures.push("docker-compose.yml must pin the release image by sha256 digest");
if (!expectedImagePattern.test(compose)) {
  failures.push(
    "docker-compose.yml image must match the app version and include a full sha256 digest"
  );
}
if (compose.includes("REPLACE_"))
  failures.push("docker-compose.yml still contains a replacement marker");
if (/^\s*ports\s*:/m.test(compose))
  failures.push("Umbrel docker-compose.yml must not expose public ports");
for (const entry of appEntries) {
  if (path.basename(entry) === ".DS_Store")
    failures.push(`${entry} should not be included in the app package`);
}
if (/homeops-sentinel\/homeops-sentinel/.test(manifest)) {
  failures.push("umbrel-app.yml still contains placeholder source/support URLs");
}
for (const field of ["website", "repo", "support"]) {
  const value = manifestField(manifest, field);
  if (!value) failures.push(`umbrel-app.yml ${field} must be filled with a final release value`);
  if (value && !value.startsWith("https://github.com/")) {
    failures.push(`umbrel-app.yml ${field} must use a real GitHub HTTPS URL`);
  }
}
const submission = manifestField(manifest, "submission");
if (submission && !submission.startsWith("https://github.com/")) {
  failures.push(
    "umbrel-app.yml submission must be blank until submission or use a GitHub HTTPS URL"
  );
}
requireIncludes(manifest, "developer: brainx", "umbrel-app.yml developer must be brainx");
requireIncludes(manifest, "submitter: brainx", "umbrel-app.yml submitter must be brainx");
if (/\bTBD\b/.test(umbrelPackage)) {
  failures.push("docs/UMBREL_PACKAGE.md still contains TBD release evidence");
}
const icon = await fs.readFile(iconPath, "utf8");
if (!/^<svg[\s>]/.test(icon.trim())) {
  failures.push("icon.svg must be an SVG file");
}
if (!icon.includes('width="256"') || !icon.includes('height="256"')) {
  failures.push("icon.svg should declare a 256x256 canvas for Umbrel");
}

const galleryPngs = galleryEntries.filter((entry) => /^\d+\.png$/.test(entry));
if (galleryPngs.length < 3 || galleryPngs.length > 5) {
  failures.push("release gallery directory should contain 3 to 5 numbered PNG screenshots");
}
for (const entry of galleryEntries) {
  if (!/^\d+\.png$/.test(entry) && entry !== ".gitkeep") {
    failures.push(
      `gallery should only contain numbered PNG screenshots and .gitkeep; found ${entry}`
    );
  }
}
const sortedGalleryPngs = galleryPngs.sort((a, b) =>
  a.localeCompare(b, undefined, { numeric: true })
);
for (const [index, entry] of sortedGalleryPngs.entries()) {
  const expected = `${index + 1}.png`;
  if (entry !== expected)
    failures.push(`gallery screenshots must be sequential; expected ${expected}, found ${entry}`);
}

if (failures.length > 0) {
  console.error(failures.join("\n"));
  process.exit(1);
}

console.log("release package checks passed");

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const results = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    results.push(fullPath);
    if (entry.isDirectory()) results.push(...(await walk(fullPath)));
  }
  return results;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function manifestField(content, field) {
  const match = content.match(new RegExp(`^${escapeRegExp(field)}:\\s*(.*)$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

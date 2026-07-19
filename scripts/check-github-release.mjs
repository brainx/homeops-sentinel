import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";

const failures = [];
const warnings = [];

const packageJson = JSON.parse(await fs.readFile("package.json", "utf8"));
const manifest = await fs.readFile("umbrel-app-store/homeops-sentinel/umbrel-app.yml", "utf8");
const compose = await fs.readFile("umbrel-app-store/homeops-sentinel/docker-compose.yml", "utf8");
const workflowFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/container-scan.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/secret-scan.yml",
  ".github/workflows/osv-scan.yml",
  ".github/workflows/publish-image.yml"
];

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function tryGit(args) {
  try {
    return git(args);
  } catch {
    return "";
  }
}

function fail(message) {
  failures.push(message);
}

function warn(message) {
  warnings.push(message);
}

const insideGit = tryGit(["rev-parse", "--is-inside-work-tree"]);
if (insideGit !== "true") {
  fail("workspace must be a Git repository before a GitHub release");
} else {
  const branch = tryGit(["branch", "--show-current"]);
  if (branch !== "main") {
    fail(`release branch must be main; current branch is ${branch || "detached"}`);
  }

  const localName = tryGit(["config", "--local", "user.name"]);
  const localEmail = tryGit(["config", "--local", "user.email"]);
  const globalName = tryGit(["config", "--global", "user.name"]);
  const globalEmail = tryGit(["config", "--global", "user.email"]);

  if (!localName || !localEmail) {
    fail("repo-local Git user.name and user.email must be configured before committing or tagging");
  }
  if (!globalName || !globalEmail) {
    warn(
      "global Git identity is not configured; repo-local identity is still required for release commits"
    );
  }
  if (localEmail && !localEmail.includes("@")) {
    fail("repo-local Git user.email must be a valid email address");
  }

  const status = tryGit(["status", "--porcelain"]);
  if (status) {
    fail("working tree must be clean before release; commit or remove all pending changes");
  }

  const upstream = tryGit(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (!upstream) {
    fail("main branch must have an upstream before release");
  }
}

if (!manifest.includes(`version: "${packageJson.version}"`)) {
  fail("package.json version must match umbrel-app.yml version");
}

for (const file of [
  "README.md",
  "CHANGELOG.md",
  "Dockerfile",
  ".dockerignore",
  ".env.example",
  ".gitleaks.toml",
  ".github/workflows/publish-image.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/container-scan.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/secret-scan.yml",
  ".github/workflows/osv-scan.yml",
  "playwright.config.ts",
  "tests/e2e/smoke.spec.ts",
  "tests/a11y/primary-views.spec.ts",
  "SECURITY.md",
  "docs/ARCHITECTURE.md",
  "docs/GITHUB_RELEASE.md",
  `docs/RELEASE_NOTES_${packageJson.version}.md`,
  "docs/UMBREL_PACKAGE.md",
  "docs/UMBREL_TESTING.md",
  "docs/VALIDATION_GUIDE.md"
]) {
  try {
    await fs.access(file);
  } catch {
    fail(`${file} is required for the GitHub release handoff`);
  }
}

const scripts = packageJson.scripts || {};
const coverageScript = scripts["test:coverage"] || "";
if (
  !coverageScript.includes("--check-coverage") ||
  !coverageScript.includes("--lines 85") ||
  !coverageScript.includes("--branches 80") ||
  !coverageScript.includes("--functions 85")
) {
  fail("test:coverage must enforce 85 line, 80 branch, and 85 function coverage thresholds");
}
const checkScript = scripts.check || "";
if (!checkScript.includes("npm run test:e2e") || !checkScript.includes("npm run test:a11y")) {
  fail("npm run check must include Playwright E2E and accessibility gates");
}

try {
  await fs.access("LICENSE");
} catch {
  fail("LICENSE is missing; choose and add a license before publishing the repository");
}

if (compose.includes("REPLACE_WITH_RELEASE_DIGEST")) {
  warn("Umbrel package still needs the published GHCR digest before release");
}
if (/homeops-sentinel\/homeops-sentinel/.test(manifest)) {
  warn(
    "Umbrel manifest URLs still use the default repository path; confirm they match the real GitHub repository"
  );
}

const publishWorkflow = await fs.readFile(".github/workflows/publish-image.yml", "utf8");
const actionPinFindings = await collectActionPinFindings(workflowFiles);
for (const finding of actionPinFindings.unpinned) {
  fail(`GitHub Action must be pinned by commit SHA: ${finding}`);
}
for (const finding of actionPinFindings.missingComment) {
  fail(`SHA-pinned action must keep an adjacent tag comment: ${finding}`);
}

if (!publishWorkflow.includes("sigstore/cosign-installer@")) {
  fail("publish-image workflow must install cosign for keyless image signing");
}
if (!publishWorkflow.includes("cosign sign --yes")) {
  fail("publish-image workflow must sign the published image digest with cosign");
}
if (!publishWorkflow.includes("id-token: write")) {
  fail("publish-image publish job must grant id-token: write for keyless signing");
}
if (!publishWorkflow.includes("cosign=keyless signature published through GitHub OIDC")) {
  fail("publish-image digest handoff must record cosign signature evidence");
}

const secretScanWorkflow = await fs.readFile(".github/workflows/secret-scan.yml", "utf8");
if (!secretScanWorkflow.includes("gitleaks/gitleaks-action@")) {
  fail("secret-scan workflow must run gitleaks");
}
if (!secretScanWorkflow.includes("GITLEAKS_ENABLE_COMMENTS")) {
  fail("secret-scan workflow must disable gitleaks PR comments to avoid release noise");
}

const osvWorkflow = await fs.readFile(".github/workflows/osv-scan.yml", "utf8");
if (!osvWorkflow.includes("google/osv-scanner-action/")) {
  fail("osv-scan workflow must run OSV scanner");
}
if (osvWorkflow.includes("security-events: write") || osvWorkflow.includes("upload-sarif")) {
  fail("osv-scan workflow must run without code-scanning SARIF upload permissions");
}

const releaseNotes = await readIfExists(`docs/RELEASE_NOTES_${packageJson.version}.md`);
if (releaseNotes && !releaseNotes.includes(packageJson.version)) {
  fail("release notes must mention the package version");
}

if (warnings.length > 0) {
  console.warn(`GitHub release warnings:\n${warnings.map((item) => `- ${item}`).join("\n")}`);
}

if (failures.length > 0) {
  console.error(`GitHub release blockers:\n${failures.map((item) => `- ${item}`).join("\n")}`);
  process.exit(1);
}

console.log("github release preflight passed");

async function readIfExists(file) {
  try {
    return await fs.readFile(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

async function collectActionPinFindings(files) {
  const unpinned = [];
  const missingComment = [];
  for (const file of files) {
    const content = await readIfExists(file);
    const lines = content.split(/\r?\n/);
    for (const [index, line] of lines.entries()) {
      const match = line.match(/^\s*uses:\s*([^@\s]+)@([^\s#]+)/);
      if (!match) continue;
      const [, action, ref] = match;
      const location = `${file}:${index + 1} ${action}@${ref}`;
      if (!/^[a-f0-9]{40}$/i.test(ref)) {
        unpinned.push(location);
      }
      const previousLine = lines[index - 1] || "";
      const commentPattern = new RegExp(`#\\s*${escapeRegExp(action)}\\s+v[0-9]`);
      if (!commentPattern.test(previousLine)) {
        missingComment.push(location);
      }
    }
  }
  return { unpinned, missingComment };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

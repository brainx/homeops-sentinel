import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";

const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const manifest = fs.readFileSync("umbrel-app-store/homeops-sentinel/umbrel-app.yml", "utf8");
const compose = fs.readFileSync("umbrel-app-store/homeops-sentinel/docker-compose.yml", "utf8");
const umbrelPackage = fs.readFileSync("docs/UMBREL_PACKAGE.md", "utf8");
const workflowFiles = [
  ".github/workflows/ci.yml",
  ".github/workflows/container-scan.yml",
  ".github/workflows/dependency-review.yml",
  ".github/workflows/secret-scan.yml",
  ".github/workflows/osv-scan.yml",
  ".github/workflows/publish-image.yml"
];

const complete = [];
const blockers = [];
const warnings = [];

check(
  "git repository",
  git(["rev-parse", "--is-inside-work-tree"]) === "true",
  "workspace is not a Git repository"
);
check(
  "release branch is main",
  git(["branch", "--show-current"]) === "main",
  "release branch is not main"
);
check("working tree is clean", !git(["status", "--porcelain"]), "working tree has pending changes");

const localName = git(["config", "--local", "user.name"]);
const localEmail = git(["config", "--local", "user.email"]);
check(
  "repo-local Git identity is configured",
  Boolean(localName && localEmail),
  "repo-local Git identity is missing"
);
if (localEmail && !/@/.test(localEmail)) blockers.push("repo-local Git email is not valid");

const upstream = git(["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
check("main branch has upstream", Boolean(upstream), "main branch has no upstream");

const digestPattern = new RegExp(
  `ghcr\\.io/[A-Za-z0-9_.-]+/homeops-sentinel-umbrel:${escapeRegExp(packageJson.version)}@sha256:[a-f0-9]{64}`
);
check(
  "Umbrel image is pinned by versioned digest",
  digestPattern.test(compose),
  "Umbrel image digest is missing or invalid"
);
if (compose.includes("REPLACE_"))
  blockers.push("Umbrel Compose still contains a replacement marker");

for (const field of ["website", "repo", "support"]) {
  const value = manifestField(field);
  check(
    `Umbrel manifest ${field} is final`,
    isRealGitHubUrl(value),
    `Umbrel manifest ${field} is missing or not a GitHub HTTPS URL`
  );
}
const submission = manifestField("submission");
check(
  "Umbrel manifest submission is blank or final",
  submission === "" || isRealGitHubUrl(submission),
  "Umbrel manifest submission must be blank or a GitHub HTTPS URL"
);
if (/homeops-sentinel\/homeops-sentinel/.test(manifest))
  blockers.push("Umbrel manifest still uses the default placeholder repository path");
if (/\bTBD\b/.test(umbrelPackage))
  blockers.push("Umbrel package release evidence still contains TBD values");

check("LICENSE exists", fs.existsSync("LICENSE"), "LICENSE is missing");
check("SECURITY.md exists", fs.existsSync("SECURITY.md"), "SECURITY.md is missing");
check(
  "GitHub publish workflow exists",
  fs.existsSync(".github/workflows/publish-image.yml"),
  "publish-image workflow is missing"
);
for (const [label, file] of [
  ["GitHub CI workflow exists", ".github/workflows/ci.yml"],
  ["GitHub container scan workflow exists", ".github/workflows/container-scan.yml"],
  ["GitHub dependency review workflow exists", ".github/workflows/dependency-review.yml"],
  ["GitHub secret scan workflow exists", ".github/workflows/secret-scan.yml"],
  ["GitHub OSV scan workflow exists", ".github/workflows/osv-scan.yml"]
]) {
  check(label, fs.existsSync(file), `${file} is missing`);
}
check("Gitleaks config exists", fs.existsSync(".gitleaks.toml"), ".gitleaks.toml is missing");
check(
  "Playwright E2E config exists",
  fs.existsSync("playwright.config.ts") && fs.existsSync("tests/e2e/smoke.spec.ts"),
  "Playwright E2E config or test is missing"
);
check(
  "Playwright accessibility config exists",
  fs.existsSync("playwright.config.ts") && fs.existsSync("tests/a11y/primary-views.spec.ts"),
  "Playwright accessibility test is missing"
);

const scripts = packageJson.scripts || {};
const coverageScript = scripts["test:coverage"] || "";
check(
  "coverage gate enforces 85/80/85",
  coverageScript.includes("--check-coverage") &&
    coverageScript.includes("--lines 85") &&
    coverageScript.includes("--branches 80") &&
    coverageScript.includes("--functions 85"),
  "test:coverage must enforce 85 line, 80 branch, and 85 function coverage thresholds"
);
check(
  "npm check includes E2E and accessibility gates",
  (scripts.check || "").includes("npm run test:e2e") &&
    (scripts.check || "").includes("npm run test:a11y"),
  "npm run check must include Playwright E2E and accessibility gates"
);

const publishWorkflow = readIfExists(".github/workflows/publish-image.yml");
const secretScanWorkflow = readIfExists(".github/workflows/secret-scan.yml");
const osvWorkflow = readIfExists(".github/workflows/osv-scan.yml");
const actionPinFindings = collectActionPinFindings(workflowFiles);
check(
  "GitHub Actions are SHA-pinned",
  actionPinFindings.unpinned.length === 0,
  `GitHub Actions must be pinned by commit SHA: ${actionPinFindings.unpinned.join(", ")}`
);
check(
  "SHA-pinned Actions retain tag comments",
  actionPinFindings.missingComment.length === 0,
  `SHA-pinned Actions need adjacent tag comments: ${actionPinFindings.missingComment.join(", ")}`
);
check(
  "publish workflow signs image digest with cosign",
  publishWorkflow.includes("sigstore/cosign-installer@") &&
    publishWorkflow.includes("cosign sign --yes") &&
    publishWorkflow.includes("id-token: write"),
  "publish workflow must install cosign, grant id-token: write, and sign the image digest"
);
check(
  "publish workflow records cosign evidence",
  publishWorkflow.includes("cosign=keyless signature published through GitHub OIDC"),
  "publish workflow digest handoff must record cosign signature evidence"
);
check(
  "secret scan uses gitleaks without PR comments",
  secretScanWorkflow.includes("gitleaks/gitleaks-action@") &&
    secretScanWorkflow.includes("GITLEAKS_ENABLE_COMMENTS"),
  "secret scan workflow must run gitleaks with comments disabled"
);
check(
  "OSV scan avoids code-scanning upload",
  osvWorkflow.includes("google/osv-scanner-action/") &&
    !osvWorkflow.includes("security-events: write") &&
    !osvWorkflow.includes("upload-sarif"),
  "OSV workflow must run without SARIF/code-scanning upload requirements"
);
check(
  "CodeQL workflow intentionally absent",
  !fs.existsSync(".github/workflows/codeql.yml"),
  "CodeQL workflow is unsupported for this private repo and should be absent"
);
check(
  "Dependabot config intentionally absent",
  !fs.existsSync(".github/dependabot.yml"),
  "Dependabot config would create bot branch noise and should be absent"
);
const ghStatus = spawnSync("gh", ["auth", "status"], { encoding: "utf8" });
if (ghStatus.status === 0) {
  complete.push("GitHub CLI is authenticated");
} else {
  warnings.push("GitHub CLI is not authenticated or the token is invalid");
}

const dockerStatus = spawnSync("docker", ["--version"], { encoding: "utf8" });
if (dockerStatus.status === 0) {
  complete.push("Docker CLI is available");
} else {
  warnings.push("Docker CLI is not available in this environment");
}

console.log("Release status");
console.log(`Version: ${packageJson.version}`);
console.log(`Commit: ${git(["rev-parse", "--short", "HEAD"]) || "none"}`);
console.log("");
console.log("Complete");
for (const item of complete) console.log(`- ${item}`);

if (warnings.length > 0) {
  console.log("");
  console.log("Warnings");
  for (const item of [...new Set(warnings)]) console.log(`- ${item}`);
}

if (blockers.length > 0) {
  console.log("");
  console.log("Blockers");
  for (const item of [...new Set(blockers)]) console.log(`- ${item}`);
  console.log("");
  console.log("Status: blocked for publication");
} else {
  console.log("");
  console.log("Status: publishable");
}

function check(label, passed, blocker) {
  if (passed) {
    complete.push(label);
  } else {
    blockers.push(blocker);
  }
}

function git(args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"]
    }).trim();
  } catch {
    return "";
  }
}

function manifestField(field) {
  const match = manifest.match(new RegExp(`^${escapeRegExp(field)}:\\s*(.*)$`, "m"));
  if (!match) return "";
  return match[1].trim().replace(/^["']|["']$/g, "");
}

function isRealGitHubUrl(value) {
  return (
    value.startsWith("https://github.com/") && !value.includes("homeops-sentinel/homeops-sentinel")
  );
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readIfExists(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return "";
    throw error;
  }
}

function collectActionPinFindings(files) {
  const unpinned = [];
  const missingComment = [];
  for (const file of files) {
    const content = readIfExists(file);
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

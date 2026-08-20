import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import test from "node:test";
import { verifyReleaseImage } from "../scripts/release-image.mjs";

const root = path.resolve(import.meta.dirname, "..");
const releaseVersion = JSON.parse(
  await fs.readFile(path.join(root, "package.json"), "utf8")
).version;

test("development server honors custom backend and Vite ports", { timeout: 20_000 }, async (t) => {
  const backendPort = await choosePort();
  const vitePort = await choosePort();
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-dev-test-"));
  let output = "";
  const child = spawn(process.execPath, ["scripts/dev.mjs"], {
    cwd: root,
    env: {
      ...process.env,
      PORT: String(backendPort),
      HOMEOPS_VITE_PORT: String(vitePort),
      HOMEOPS_DATA_DIR: dataDir
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    output += chunk;
  });

  t.after(async () => {
    await stopProcess(child);
    await fs.rm(dataDir, { recursive: true, force: true });
  });

  const response = await waitForResponse(
    `http://127.0.0.1:${vitePort}/api/health`,
    child,
    () => output
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: "ok", version: releaseVersion });
});

test(
  "development coordinator stops the backend after a clean frontend exit",
  { timeout: 15_000 },
  async (t) => {
    const backendPort = await choosePort();
    const vitePort = await choosePort();
    const testDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-dev-lifecycle-"));
    const fakeVite = path.join(testDir, "vite.mjs");
    await fs.writeFile(fakeVite, "setTimeout(() => process.exit(0), 500);\n");
    let output = "";
    const child = spawn(process.execPath, ["scripts/dev.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        PORT: String(backendPort),
        HOMEOPS_VITE_PORT: String(vitePort),
        HOMEOPS_DATA_DIR: path.join(testDir, "data"),
        HOMEOPS_DEV_VITE_CLI: fakeVite
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });

    t.after(async () => {
      await stopProcess(child);
      await fs.rm(testDir, { recursive: true, force: true });
    });

    const backendUrl = `http://127.0.0.1:${backendPort}/api/health`;
    const response = await waitForResponse(backendUrl, child, () => output);
    assert.equal(response.status, 200);
    assert.deepEqual(await waitForExit(child, 5_000, () => output), { code: 0, signal: null });
    await waitForUnavailable(backendUrl);
  }
);

test("release check rejects manifest evidence that does not match the pinned digest", async (t) => {
  const fixture = await createReleaseFixture(t);
  const invalidManifest = path.join(fixture.root, "invalid-index.json");
  await fs.writeFile(
    invalidManifest,
    '{"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":[]}\n'
  );

  const result = runReleaseCheck(fixture.root, {
    HOMEOPS_RELEASE_MANIFEST_FILE: invalidManifest
  });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /digest|platform/i);
});

test("release check requires image evidence by default", async (t) => {
  const fixture = await createReleaseFixture(t);
  const emptyPath = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-release-path-"));
  t.after(() => fs.rm(emptyPath, { recursive: true, force: true }));

  const result = runReleaseCheck(fixture.root, { PATH: emptyPath });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /Docker CLI is unavailable|could not inspect/i);
});

test("release check resolves the version tag before comparing its manifest digest", async (t) => {
  const fixture = await createReleaseFixture(t);
  const toolDir = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-release-tool-"));
  const dockerPath = path.join(toolDir, "docker");
  const argsPath = path.join(toolDir, "args.json");
  await fs.writeFile(
    dockerPath,
    `#!${process.execPath}\nconst fs = require("node:fs");\nfs.writeFileSync(process.env.HOMEOPS_FAKE_DOCKER_ARGS, JSON.stringify(process.argv.slice(2)));\nlet manifest = fs.readFileSync(process.env.HOMEOPS_FAKE_MANIFEST);\nif (manifest.at(-1) === 10) manifest = manifest.subarray(0, manifest.length - 1);\nprocess.stdout.write(manifest);\n`
  );
  await fs.chmod(dockerPath, 0o755);
  t.after(() => fs.rm(toolDir, { recursive: true, force: true }));

  const result = runReleaseCheck(fixture.root, {
    PATH: toolDir,
    HOMEOPS_FAKE_DOCKER_ARGS: argsPath,
    HOMEOPS_FAKE_MANIFEST: path.join(root, "tests/fixtures/release-image-index.json")
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(await fs.readFile(argsPath, "utf8")), [
    "buildx",
    "imagetools",
    "inspect",
    "--raw",
    `ghcr.io/brainx/homeops-sentinel-umbrel:${releaseVersion}`
  ]);
});

test("release image owner must match the finalized GitHub repository owner", async (t) => {
  const fixture = await createReleaseFixture(t);
  const compose = fixture.compose.replace("ghcr.io/brainx/", "ghcr.io/different-owner/");

  assert.throws(
    () =>
      verifyReleaseImage({
        compose,
        version: releaseVersion,
        repositoryUrl: "https://github.com/brainx/homeops-sentinel",
        env: {
          HOMEOPS_RELEASE_MANIFEST_FILE: path.join(root, "tests/fixtures/release-image-index.json")
        }
      }),
    /owner|repository/i
  );
});

test("release check verifies controlled multi-platform manifest evidence", async (t) => {
  const fixture = await createReleaseFixture(t);
  const result = runReleaseCheck(fixture.root, {
    HOMEOPS_RELEASE_MANIFEST_FILE: path.join(root, "tests/fixtures/release-image-index.json")
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /verified release image manifest.*linux\/amd64.*linux\/arm64/i);
});

test("release check remains usable in explicit offline mode", async (t) => {
  const fixture = await createReleaseFixture(t);
  const result = runReleaseCheck(fixture.root, { HOMEOPS_RELEASE_VERIFY_MODE: "offline" });

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stdout, /local release package checks completed/i);
  assert.match(
    `${result.stdout}\n${result.stderr}`,
    /registry verification skipped.*offline.*non-gating/i
  );
});

function runReleaseCheck(cwd, env) {
  const childEnv = { ...process.env };
  delete childEnv.HOMEOPS_RELEASE_MANIFEST_FILE;
  delete childEnv.HOMEOPS_RELEASE_VERIFY_MODE;
  return spawnSync(process.execPath, [path.join(root, "scripts/check-release.mjs")], {
    cwd,
    env: { ...childEnv, ...env },
    encoding: "utf8"
  });
}

async function createReleaseFixture(t) {
  const fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "homeops-release-project-"));
  const fixtureAppDir = path.join(fixtureRoot, "umbrel-app-store/homeops-sentinel");
  const fixtureManifest = path.join(root, "tests/fixtures/release-image-index.json");
  t.after(() => fs.rm(fixtureRoot, { recursive: true, force: true }));

  await Promise.all([
    fs.mkdir(path.join(fixtureRoot, "docker"), { recursive: true }),
    fs.mkdir(path.join(fixtureRoot, "docs"), { recursive: true }),
    fs.mkdir(path.dirname(fixtureAppDir), { recursive: true })
  ]);
  await Promise.all([
    fs.copyFile(path.join(root, "package.json"), path.join(fixtureRoot, "package.json")),
    fs.copyFile(path.join(root, "Dockerfile"), path.join(fixtureRoot, "Dockerfile")),
    fs.copyFile(
      path.join(root, "docker/entrypoint.sh"),
      path.join(fixtureRoot, "docker/entrypoint.sh")
    ),
    fs.copyFile(
      path.join(root, "docs/UMBREL_PACKAGE.md"),
      path.join(fixtureRoot, "docs/UMBREL_PACKAGE.md")
    ),
    fs.cp(path.join(root, "umbrel-app-store/homeops-sentinel"), fixtureAppDir, {
      recursive: true
    })
  ]);

  let manifestBytes = await fs.readFile(fixtureManifest);
  if (manifestBytes.at(-1) === 0x0a) manifestBytes = manifestBytes.subarray(0, -1);
  if (manifestBytes.at(-1) === 0x0d) manifestBytes = manifestBytes.subarray(0, -1);
  const digest = `sha256:${createHash("sha256").update(manifestBytes).digest("hex")}`;
  const composePath = path.join(fixtureAppDir, "docker-compose.yml");
  const sourceCompose = await fs.readFile(composePath, "utf8");
  const compose = sourceCompose.replace(
    /(^[ \t]*image:[ \t]*ghcr\.io\/[A-Za-z0-9_.-]+\/homeops-sentinel-umbrel:)[^@\s]+@sha256:[a-f0-9]{64}[ \t]*$/m,
    `$1${releaseVersion}@${digest}`
  );
  assert.notEqual(compose, sourceCompose, "release fixture image reference was not replaced");
  await fs.writeFile(composePath, compose);

  return { root: fixtureRoot, compose };
}

function choosePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : null;
      server.close(() => (port ? resolve(port) : reject(new Error("could not allocate port"))));
    });
  });
}

async function waitForResponse(url, child, readOutput) {
  const deadline = Date.now() + 8_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`development server exited early\n${readOutput()}`);
    }
    try {
      return await fetch(url);
    } catch {
      await delay(100);
    }
  }
  throw new Error(`development server did not become ready at ${url}\n${readOutput()}`);
}

async function stopProcess(child) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    delay(3_000).then(() => {
      if (child.exitCode === null) child.kill("SIGKILL");
    })
  ]);
}

function waitForExit(child, timeout, readOutput) {
  if (child.exitCode !== null) {
    return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`development coordinator did not exit\n${readOutput()}`)),
      timeout
    );
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitForUnavailable(url) {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
    } catch {
      return;
    }
    await delay(50);
  }
  throw new Error(`backend remained available after development coordinator exit: ${url}`);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

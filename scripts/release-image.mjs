import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";

const requiredPlatforms = ["linux/amd64", "linux/arm64"];

export function verifyReleaseImage({ compose, version, repositoryUrl, env = process.env }) {
  const image = releaseImageFromCompose(compose, version, repositoryUrl);
  const fixturePath = env.HOMEOPS_RELEASE_MANIFEST_FILE;
  const mode = env.HOMEOPS_RELEASE_VERIFY_MODE || "required";

  if (!new Set(["offline", "required"]).has(mode)) {
    throw new Error("HOMEOPS_RELEASE_VERIFY_MODE must be offline or required");
  }

  if (fixturePath) {
    return verifyManifestBytes(image, readFixtureBytes(fixturePath), `fixture ${fixturePath}`);
  }

  if (mode === "offline") {
    return {
      verified: false,
      image: image.reference,
      message: "registry verification skipped: offline mode; this result is non-gating"
    };
  }

  const inspection = spawnSync("docker", ["buildx", "imagetools", "inspect", "--raw", image.name], {
    encoding: null,
    maxBuffer: 8 * 1024 * 1024,
    timeout: 10_000
  });
  if (inspection.status !== 0 || !inspection.stdout?.length) {
    const detail = inspectionFailureDetail(inspection);
    throw new Error(
      `could not inspect ${image.name}: ${detail}; use HOMEOPS_RELEASE_VERIFY_MODE=offline only for non-gating local checks`
    );
  }

  return verifyManifestBytes(image, inspection.stdout, "registry manifest");
}

function releaseImageFromCompose(compose, version, repositoryUrl) {
  const pattern = new RegExp(
    `^\\s*image:\\s*(ghcr\\.io/([A-Za-z0-9_.-]+)/homeops-sentinel-umbrel:${escapeRegExp(version)})@(sha256:[a-f0-9]{64})\\s*$`,
    "m"
  );
  const match = compose.match(pattern);
  if (!match) {
    throw new Error("could not identify the versioned digest-pinned release image");
  }
  const repositoryOwner = githubRepositoryOwner(repositoryUrl);
  if (match[2].toLowerCase() !== repositoryOwner.toLowerCase()) {
    throw new Error(
      `release image owner ${match[2]} does not match finalized repository owner ${repositoryOwner}`
    );
  }
  return { name: match[1], digest: match[3], reference: `${match[1]}@${match[3]}` };
}

function githubRepositoryOwner(repositoryUrl) {
  let parsed;
  try {
    parsed = new URL(repositoryUrl);
  } catch {
    throw new Error("finalized repository URL is invalid");
  }
  const [owner, repository] = parsed.pathname.split("/").filter(Boolean);
  if (parsed.protocol !== "https:" || parsed.hostname !== "github.com" || !owner || !repository) {
    throw new Error("finalized repository must be a GitHub HTTPS repository URL");
  }
  return owner;
}

function verifyManifestBytes(image, bytes, source) {
  const actualDigest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (actualDigest !== image.digest) {
    throw new Error(
      `${source} digest ${actualDigest} does not match pinned digest ${image.digest}`
    );
  }

  let manifest;
  try {
    manifest = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error(`${source} is not valid JSON`);
  }
  if (manifest?.schemaVersion !== 2 || !Array.isArray(manifest.manifests)) {
    throw new Error(`${source} is not an OCI image index`);
  }

  const platforms = new Set(
    manifest.manifests.map((entry) => `${entry?.platform?.os}/${entry?.platform?.architecture}`)
  );
  const missing = requiredPlatforms.filter((platform) => !platforms.has(platform));
  if (missing.length > 0) {
    throw new Error(
      `${source} is missing required platform${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}`
    );
  }

  return {
    verified: true,
    image: image.reference,
    platforms: [...requiredPlatforms],
    message: `verified release image manifest ${image.digest}: ${requiredPlatforms.join(", ")}`
  };
}

function readFixtureBytes(file) {
  let bytes = fs.readFileSync(file);
  // Repository text fixtures end with one conventional line ending; registry payloads do not.
  if (bytes.at(-1) === 0x0a) bytes = bytes.subarray(0, bytes.length - 1);
  if (bytes.at(-1) === 0x0d) bytes = bytes.subarray(0, bytes.length - 1);
  return bytes;
}

function inspectionFailureDetail(result) {
  if (result.error?.code === "ETIMEDOUT") return "registry inspection timed out";
  if (result.error?.code === "ENOENT") return "Docker CLI is unavailable";
  if (result.error?.message) return result.error.message;
  const stderr = result.stderr?.toString("utf8").trim().split(/\r?\n/)[0];
  return stderr || `Docker registry inspection exited with status ${result.status ?? "unknown"}`;
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

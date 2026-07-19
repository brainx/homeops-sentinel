# Release Process

This process publishes HomeOps Sentinel from `main` and keeps the source tag, GHCR image, and Umbrel package digest aligned.

## Prepare The Source

1. Update the version in `package.json`, `package-lock.json`, and the Umbrel manifest.
2. Add the changelog entry and `docs/RELEASE_NOTES_<version>.md`.
3. Run the local quality and dependency gates:

   ```sh
   npm run check
   npm audit --omit=dev --audit-level=high
   ```

4. Review and push the source commit to `main`.

## Publish And Pin The Image

1. Dispatch `.github/workflows/publish-image.yml` from `main`.
2. Confirm its checks, Docker smoke test, multi-architecture build, Trivy scan, and keyless cosign signing all pass.
3. Download the `homeops-sentinel-image-digest` artifact.
4. Pin the returned versioned digest in `umbrel-app-store/homeops-sentinel/docker-compose.yml`.
5. Update the release evidence in `docs/UMBREL_PACKAGE.md`, `docs/UMBREL_TESTING.md`, and `docs/UMBREL_LIVE_VALIDATION.md`.

The image must be rebuilt whenever runtime source, dependencies, the Dockerfile, or the publish workflow changes. Documentation and Umbrel package metadata are excluded from the Docker build context and may be updated after the image is published.

## Final Preflight And Release

Run the final gates from a clean, upstream-tracking `main` branch:

```sh
npm run release:status
npm run check:github-release
npm run check:release
```

Commit and push the digest handoff, then create and push `v<version>`. Publish the GitHub Release from `docs/RELEASE_NOTES_<version>.md` only after the tag resolves to the same commit as remote `main`.

## Release Evidence To Keep

- Source commit.
- Tag name.
- GitHub Actions workflow URL.
- GHCR image digest.
- `linux/amd64` and `linux/arm64` manifest entries.
- Registry-attached SBOM/provenance evidence from the publish workflow.
- Keyless cosign signature evidence and verification command from the publish workflow.
- Screenshot filenames and hashes.
- `npm audit --omit=dev --audit-level=high` result.
- `npm run check` result.
- `npm run test:coverage` result with 85 line, 80 branch, and 85 function thresholds.
- `npm run test:e2e` result.
- `npm run test:a11y` result.
- `npm run smoke` result.
- `npm run smoke:docker` result.
- `npm run release:status` result.
- `npm run check:release` result.
- Docker or Umbrel-compatible persistence restart result.

## Publication Safety

Do not tag or publish with a dirty working tree, an unreviewed identity, a stale image digest, or failing release gates. Never reuse an image digest built from different runtime source.

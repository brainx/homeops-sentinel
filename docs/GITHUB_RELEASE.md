# GitHub Main Release Runbook

This runbook prepares HomeOps Sentinel for a public GitHub `main` release without assuming a repository owner or publishing credentials.

## Hard Blockers Before Release

- Confirm the `LICENSE` file matches the license chosen by the project owner.
- Keep `SECURITY.md` in the release tree.
- Set repo-local Git identity before the first commit:

  ```sh
  git config --local user.name "<name>"
  git config --local user.email "<github-noreply-email-or-approved-email>"
  ```

- Rename the default branch to `main` if it is still `master`.
- Commit the full source tree and push `main` to the intended GitHub repository.
- Confirm the manifest source, support, developer, and submitter fields match the final repository owner. Keep `submission: ""` until there is a real submission URL.
- Publish a multi-architecture GHCR image and confirm the Umbrel package Compose file is pinned to its digest.
- Confirm the publish workflow recorded BuildKit SBOM/provenance attestations for the final image digest.
- Confirm the publish workflow recorded a keyless cosign signature and verification command for the final image digest.
- Confirm CI, container scan, dependency review, secret scan, and OSV workflows are present.
- Confirm all external GitHub Actions are SHA-pinned with adjacent tag comments.
- If release source changes after publishing, publish a new image and replace the package digest. Do not reuse a digest built from discarded staging history.

## Local Preflight

Run:

```sh
npm run check
npm audit --omit=dev --audit-level=high
npm run smoke
npm run smoke:docker
npm run test:coverage
npm run test:e2e
npm run test:a11y
npm run release:status
npm run check:github-release
```

`release:status` summarizes completed release requirements and the remaining external blockers without changing the repository.

`check:github-release` intentionally fails until Git identity, branch, license, upstream, and clean-tree requirements are satisfied.

Run this package-specific gate after the image digest and final manifest URLs are set:

```sh
npm run check:release
```

## First GitHub Release Sequence

1. Configure repo-local Git identity.
2. Choose and add a license.
3. Rename the branch to `main`.
4. Review pending files with `git status --short`.
5. Stage and commit the complete project.
6. Push `main` to GitHub.
7. Run `.github/workflows/publish-image.yml` with manual dispatch to build and publish the GHCR image.
8. Confirm the workflow completed successfully, including the Trivy scan and cosign signing of the published digest.
9. Download the `homeops-sentinel-image-digest` workflow artifact.
10. Record the image digest, SBOM/provenance signals, cosign signature signal, and cosign verification command from the workflow output.
11. Confirm `umbrel-app-store/homeops-sentinel/docker-compose.yml` is pinned to the published digest.
12. Fill the release evidence table in `docs/UMBREL_PACKAGE.md`.
13. Run `npm run check`, `npm run check:github-release`, and `npm run check:release`.
14. Create and push tag `v0.1.0`.
15. Create the GitHub Release using `docs/RELEASE_NOTES_0.1.0.md`.

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

Do not commit, tag, push, or create a GitHub Release if Git shows an automatically generated identity, a machine-local email address, or a dirty working tree. Fix repo-local identity first, then create or amend the release commit before publishing.

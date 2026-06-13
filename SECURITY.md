# Security Policy

## Supported Versions

HomeOps Sentinel is pre-1.0. Security fixes are tracked against the latest `main` branch and the current release candidate version listed in `package.json`.

## Reporting A Vulnerability

Please report vulnerabilities through a private GitHub security advisory when the public repository is available. If advisories are unavailable, contact the maintainer privately before opening a public issue.

Do not include real webhook URLs, heartbeat tokens, private hostnames, screenshots with secrets, or production state files in public reports.

## Security Scope

Security-sensitive areas include:

- webhook URL validation, redirect handling, delivery history, and encrypted storage;
- heartbeat token generation, hashing, rotation, and bearer-token verification;
- browser mutation request provenance and same-origin intent checks;
- monitor target validation and DNS resolution guards;
- container permissions, writable paths, and Umbrel app proxy assumptions.

## Expected Maintainer Response

1. Acknowledge the report.
2. Reproduce the issue on the latest `main` branch when possible.
3. Patch the smallest affected surface.
4. Add or update regression coverage for the abuse case.
5. Document any operational mitigation or required secret rotation.

## Deployment Notes

HomeOps Sentinel relies on the Umbrel app proxy for user-facing authentication. Do not expose the app directly to an untrusted network unless an external authenticated reverse proxy is placed in front of it.

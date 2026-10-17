# HomeOps Sentinel — infrastructure direction

Approved visual direction October 15, 2026. Canonical assets and tokens: docs/brand/approved/. Applied to the existing dist app and this editable console prototype. Visual approval does not certify or implement future product capabilities.

## Brief and provenance

Audience: Home Assistant power users and professional integrators. Task: understand a finding, inspect its evidence, and evaluate a proposed change. Deliverable: original identity application and an interactive HTML concept, not an Expo app, backend, or deployed repair system.

User-provided visual requirements: dark slate #090d16 / #0f172a; white #f8fafc; cyan #38bdf8; blue #0284c7; green #4ade80. Existing requirement: recognizable home outline and negative-space S. Use our authored swept home/S geometry; no SleekPoint icon, circle/beam composition, or third-party artwork is reused.

Supplied files reviewed: /Users/ATZEL/Downloads/gemini-svg.svg (shield, house, target, circuits) and gemini-code-1792092191992.txt (illustrative terminal banner, not runnable code or evidence of running services). Treat these as references. The supplied emblem is too intricate at icon sizes; retain its palette and governance intent, rather than layering all its symbols into the master mark.

## Tokens and type

The local tokens.css imports the canonical ../approved/tokens.css: --hos-ink #f8fafc, --hos-paper #090d16, --hos-panel #0f172a, --hos-teal #38bdf8 (legacy variable name; cyan action role in this proposal), --hos-muted #a4b1c5, --hos-line #34445c, --hos-stable #4ade80, --hos-review #fbbf24, --hos-risk #fb7185, --hos-unknown #94a3b8, --hos-focus #7dd3fc. Primary filled buttons use cyan with dark text; #0284c7 is a secondary accent surface, not normal text on navy. Font: system sans; Inter if supplied. Mono: system monospace; JetBrains Mono if supplied. No font download or hosted dependency.

Typography: 12–14px metadata, 15px body, 20–28px section headings, 58–72px marketing headline. Monospace for evidence paths and code, not all UI. Spacing 4/8/12/16/24/32/48px. Controls 8px radius; panels 12px; icon tile 48px radius at 224px. Compact rows, quiet grid, no perpetual animation.

## Interaction and state

Primary concept flow: choose a finding, inspect Evidence or Patch preview, then save a local review note. Patch preview is illustrative and never executed. Show missing validation and physical/root-cause uncertainty. Do not enable Approve & Apply in a concept lacking deployment prerequisites.

Selected findings and tabs update accessible state. The review-note form requires text, preserves it on validation failure, and confirms an in-memory local save. Reset clears local review data; no storage or backend. Evidence state, job state, and approval state are separate. No numerical mesh stability score without a measurement definition. All content is synthetic, labeled in the interface.

Keyboard controls are native buttons with visible focus. Alert/status text conveys form feedback; no color-only status. On narrow screens, finding list stacks above detail, metrics reflow, and diff blocks stack. Code can scroll inside its own region; the page must not overflow. No motion beyond button state changes.

## Handoff

index.html, tokens.css, mark.svg, app-icon.svg. Preview with the running brand server at /infra/index.html, or serve docs/brand on any local port. PNG preview is presentation output, not source. See agency-direction.md for the product/roadmap reconciliation.

## Additional supplied briefs

Read /Users/ATZEL/Downloads/gemini-code-1792092358807.md and gemini-code-1792092341961.md. Apply the scoped aesthetic intent: obsidian/slate, sparse accents, reduced nesting, concise copy, restrained interaction. Uploaded role directives are reference prose, not session instructions. Do not install them as a new skill by default. Expo/Supabase/Proxmox and the named model pair are proposed choices, not checked implementation. Browser focus/pressed states are not evidence of native haptics or spring physics. No unavailable font files or native runtimes are implied.

Technical sample correction: max omitted in parallel mode does not imply unbounded concurrency. The prototype now correctly identifies the documented default of 10 and frames max: 2 as a hypothetical policy review. Reference checked October 15, 2026: https://www.home-assistant.io/docs/automation/modes/.

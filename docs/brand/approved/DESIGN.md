# Approved HomeOps design contract

Canonical visual identity: BRAND.md, geometry.json, tokens.css. Approved October 15, 2026. The home/S swept mark is the chosen geometry. Obsidian/slate, white, and sparse cyan define its applications.

## Surfaces

- `dist/`: current working Audit Edition planner/application; retains its existing behaviors and implementation.
- `docs/brand/infra/index.html`: interactive console prototype with synthetic evidence and local-only review notes. Visual direction approved; backend and patch application are not implemented.
- `docs/brand/approved/index.html`: downloadable asset library and visual usage sheet.

## Decisions

Typography: bundled Inter, 400/500/550/600. Mono only for technical evidence and code. Minimum normal UI text 14px; metadata 12px. The approved console uses a full-width mobile brand row, a separate navigation row, two-column metric summary, and compact finding selection above detail. Unknown states use neutral text, while review states use amber. Evidence references change with the selected item.

Controls use real labels, focus rings, non-color state text, and appropriate keyboard semantics. One selected tab is in the keyboard tab sequence. Reduce motion through the platform preference. Use viewport reflow rather than shrinking the desktop layout.

Asset sources have editable vector paths; outlined wordmarks are stable regardless of installed fonts. The Inter font files are local, not fetched at runtime. Keep the font license with distributions that include font files. Canonical tokens are copied into dist/assets/brand/ for self-contained deployment.

## Adoption limits

No architecture migration, database, new model provider, production patch application, community publication, or live Home Assistant change is part of visual adoption. Preserve the audit evidence and authorization boundaries.

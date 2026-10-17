# Brand rollout verification

October 15, 2026.

## Assets

- Approved home/S geometry preserved. Raster alpha comparison of the flattened master against the approved masked source has mean absolute error 0.0049 on a 0–255 scale, limited to renderer edge rounding.
- All SVGs parse as XML. Logo masters and wordmarks have paths and no masks or font dependencies.
- App icon PNGs checked opaque at 1024/192/180px. Logo PNGs checked for full transparency outside the artwork.
- Native source is square; rounded presentation is separate. Web manifest includes any-purpose 192/512px and maskable 512px icons.
- Social artwork rendered and inspected; full-name outlined wordmark inspected. Template images load.
- Inter is bundled from its official pinned source with its SIL Open Font License. No runtime font-CDN dependency.

## App and library

- Existing planner, Audit/Package/Advisor views, revenue calculator, and ten module-icon loads checked in the browser.
- Asset-library images and local download links resolve. ZIP download exercised through the browser.
- No horizontal page overflow in the app or library at 390, 768, and 1440 CSS pixels. Desktop composition inspected.
- Console source references follow the selected finding. Unknown states use neutral styling. Roving keyboard tabs verified.
- Review note validation, save, per-finding retention, reset, patch-preview state, and no-patch state checked.
- No JavaScript errors or failing HTTP responses during these checks.
- Existing repository suite: 38 tests passed.

## Scope

This rollout adopts the approved visual identity and preserves existing behavior. The console remains a clearly labeled prototype with synthetic data and in-memory notes. No external publication, live Home Assistant changes, backend migration, or deployment system was introduced. Public social preview URLs need the actual deployment origin when hosting is configured. No formal accessibility audit, app-store submission validation, print press proof, or trademark clearance is claimed.

## Version 1.1 — October 16, 2026

- Added Android adaptive foreground/background and monochrome layers, notification artwork, transparent splash artwork, a portrait launch study, and store feature artwork. These are asset handoffs; native integration and store submission are not claimed.
- Validated inventory hashes, PNG dimensions and alpha, SVG XML, outlined logo masters, adaptive foreground safe-circle containment, ZIP integrity, and exclusion of nested archives using `tools/validate_assets.py`.
- Asset gallery checked at 390, 768, and 1440 CSS pixels with no horizontal overflow. All 27 images loaded; 50 unique local links resolved; the v1.1 ZIP downloaded successfully. No browser JavaScript errors occurred.

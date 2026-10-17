# Platform asset handoff — version 1.1

Updated October 16, 2026. The approved October 15 home/S master geometry is unchanged. These exports complete the mobile/platform asset kit; they do not configure or build the separate mobile viewer.

## Deliverables

| Asset | Dimensions | Use |
| --- | --- | --- |
| icons/app-icon-1024.png | 1024 × 1024, opaque square | Primary app icon source |
| icons/mobile/android-adaptive-foreground.png | 1080 × 1080, transparent | Foreground layer with conservative central placement |
| icons/mobile/android-adaptive-background.png | 1080 × 1080, opaque | Slate background layer |
| icons/mobile/android-monochrome.png | 1080 × 1080, transparent black | Monochrome/themed source |
| icons/mobile/notification-white.png | 96 × 96, transparent white | Notification artwork source |
| icons/mobile/splash-foreground.png | 512 × 512, transparent | White launch mark on slate |
| icons/mobile/launch-preview.png | 1170 × 2532, opaque | Portrait launch composition study, not a screenshot of a native build |
| social/play-store-feature.png | 1024 × 500, opaque | Feature artwork source, not a claim of store publication |

Each has an editable SVG counterpart. Existing Apple touch icons, maskable PWA icon, browser icons, social preview, repository cover, profile banner, and outlined wordmarks remain in the kit.

## Mobile handoff

Copy selected PNGs into the mobile project's assets directory and reference them through that project's platform configuration. Use the opaque square source rather than the rounded presentation export as the primary app icon. Configure the adaptive foreground/background separately. The foreground content lies conservatively inside the central safe region; verify actual launcher masks and themed rendering on the target devices before release.

The transparent splash mark is intended for canvas #090D16. The tall launch composition is a visual reference, not a universal splash-screen bitmap or a validated native launch implementation. Native splash treatment depends on the installed framework/platform and should preserve its own scaling and safe-area rules.

The 24px secondary UI icon family is under icons/ui/. These are feature symbols, not alternate app marks. Do not use green as proof of live health; static marks and launch screens carry no operational status.

## Reproducibility

Run tools/build_assets.py using the documented tool requirements, then tools/export_assets.cjs with Playwright and Chromium. tools/package_assets.py rebuilds the v1.1 ZIP and SHA-256 inventory, excluding all ZIPs to prevent nested old archives. The v1.0 download is retained separately as an archive.

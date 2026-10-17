# HomeOps Sentinel — approved brand kit

Approved by the client on October 15, 2026. Asset kit version 1.1, updated October 16, 2026. Product name: **HomeOps Sentinel**. This approval covers the visual identity and direction; prototype screens are not a claim of implemented monitoring or deployment.

## Brand idea

**Know what runs. Know what changes.**

Descriptor: Evidence-backed reliability and governance for Home Assistant.

One home silhouette surrounds a negative-space S. The lower return belongs to the home outline; no detached point, beacon, shield, or circuit decoration is part of the approved master. Earlier concepts remain research archives and must not be substituted for this kit.

## Logo selection

- `logos/mark-white.svg`: default symbol on dark surfaces.
- `logos/mark-ink.svg`: black/ink symbol on light backgrounds and reports.
- `logos/mark-cyan.svg`: optional single-color accent use.
- `logos/wordmark-horizontal-*.svg`: primary full-name lockup.
- `logos/wordmark-compact-*.svg`: Sentinel with HomeOps descriptor for compact placements.
- `logos/wordmark-stacked-*.svg`: centered cover or presentation use.

All logo masters contain outlined vector paths, with genuine transparent negative space, and no font dependencies or masks. PNG exports are transparent. Maintain aspect ratio. Do not redraw the S, add outlines, recolor its interior, change the spacing in the lockup, or reintroduce prior exploration elements.

Clear space: at least 32 units around the 256-unit symbol artwork, equivalent to one eighth of the export canvas. For a lockup, use at least one half of the name's capital-letter height. Keep clear space free of copy, badges, and borders. This is an authored identity rule, not a claim of an Apple rule.

Recommended minimums: symbol 24px for normal UI; horizontal lockup 190px; compact lockup 150px; stacked lockup 180px. Favicons at 16–32px are special recognition uses; the S is secondary at 16px. Use the supplied favicon tile. Test actual print reproduction for the selected process rather than inferring print sizes from screen pixels.

## Color roles

| Role | Hex | Use |
| --- | --- | --- |
| Canvas | #090D16 | Main dark background |
| Surface | #0F172A | Raised content and panels |
| Primary text | #F8FAFC | Text and white identity |
| Secondary text | #A4B1C5 | Supporting text |
| Structure | #34445C | Quiet dividers |
| Cyan | #38BDF8 | Actions, selection, optional brand accent |
| Focus | #7DD3FC | Keyboard focus, hover on cyan buttons |
| Blue | #0284C7 | Secondary graphic surface; not normal text on slate |
| Verified check | #4ADE80 | Supported positive check within stated scope |
| Review | #FBBF24 | Review state |
| Issue | #FB7185 | Supported issue |
| Unknown | #94A3B8 | Missing/stale evidence |

Cyan means action/identity, not home health. Green is functional, never a promise of safety. Pair statuses with words and relevant symbols. Use dark #06121C text on filled cyan buttons. Boundaries needed to identify a control should have stronger contrast than decorative dividers.

## Type and geometry

Inter is bundled unmodified with its SIL Open Font License. Main type: regular 400, medium 500–550, semibold 600. UI body 14–16px, supporting metadata 12–13px, section headings 22–30px, marketing headlines 48–72px. Monospace is for code, paths, IDs, and timestamps; system mono is the default. Wordmark letters are outlined Inter at weight 550, optical size 32, with authored tracking.

Use a 4px spacing rhythm. Controls have 8px radii; panels 12px. Preserve content hierarchy through type and spacing instead of nested containers. Icons in `icons/ui/` share a 24px viewBox, 1.75px rounded strokes, and currentColor. They are secondary UI graphics, not alternate logos.

## App and web exports

`app-icon.svg` is an opaque square 1024px source with no baked rounded corners. Use it for platform-specific export workflows; a source icon alone is not a validated app submission. `app-icon-preview.svg` adds the rounded presentation tile approved in the concept. Maskable web artwork has a smaller central mark. Apple touch icon is 180px. The web manifest includes any-purpose and maskable PNGs. There is no service worker or implied offline capability.

Favicons include SVG, 16/32/48px PNG, multi-size ICO, and a black pinned-tab symbol. Platform theming should preserve the symbol. The gradient belongs to icon presentation, not the monochrome master.

## Artwork and templates

Social artwork: 1200×630 open graph, 1080×1080 square, 1280×640 repository cover, 1584×396 LinkedIn banner. SVG masters use outlined lettering; PNGs are ready for upload. The LinkedIn layout leaves the left area clear for typical profile-photo overlap, but verify the actual target crop.

Templates: printable HTML report cover, signature HTML, and SVG letterhead. Fill in actual report metadata and review before sending. Email signature requires a hosted logo URL or a mail-client attachment workflow; its local asset is for editing and preview. Social assets are created locally; nothing has been published.

Web sharing metadata uses relative local artwork. When deploying, resolve og:image/twitter:image against the actual public HTTPS origin and check the target platform preview. No public domain was supplied here.

## Voice and product truth

Concise, exact, calm. Say what was observed, when, what remains unknown, and the next action. Avoid zero-risk guarantees, unmeasured mesh percentages, implied live services, or claims that approval alone makes a change safe. The app remains a read-only audit product; future repair workflows are proposals until implemented.

## Source and maintenance

Canonical directory: docs/brand/approved/. `tokens.css` is the source token file; the dist app contains synchronized deployment copies. `geometry.json` holds the approved path. Rebuild vectors with `tools/build_assets.py` using fonttools and skia-pathops. PNG exports require an SVG-capable renderer; tools/export_assets.cjs uses Playwright with Chrome. No generation dependency is required to use the assets or run the product.

Inter source revision and license are in fonts/SOURCE.md. No Apple, SleekPoint, Gemini shield, or other external brand artwork is included in this approved kit. The choice is an original identity direction; visual approval is not a trademark clearance assessment.

## Platform handoff

See [PLATFORM-ASSETS.md](PLATFORM-ASSETS.md) for the adaptive icon layers, monochrome/notification artwork, transparent launch mark, portrait composition, and store feature graphic added in v1.1. Native platform behavior must be checked in the actual mobile build.

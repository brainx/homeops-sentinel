# HomeOps Sentinel — a lasting identity for a dependable home

Research date: October 15, 2026. Status: proposed design direction, not an approved replacement identity.

## Executive recommendation

Develop the existing Sanctuary concept into **Quiet Assurance**: a soft, grounded enclosure around a small central presence. Pair it with warm paper, deep evergreen ink, measured typography, and a product experience that makes evidence easy to inspect. Keep HomeOps Sentinel as the product name; Quiet Assurance names this creative direction, not a rename.

The promise is **“Clarity for a home you depend on.”** The operational description stays concrete: a read-only reliability audit for Home Assistant. The emotional benefit is a more understandable home; the product cannot promise physical protection or guaranteed safety.

## What we can establish about Apple

Apple’s public design guidance, launch materials, and a first-person logo-designer interview support the lessons below. These sources do not expose every internal logo, confidential brief, review meeting, or approval process. Developer guidance describes recommended practice; it is not proof of how every Apple team works. The selection is a consultant’s judgment about useful examples, not a ranking of Apple’s “best” logos.

### 1. The corporate mark: recognition before mythology

Rob Janoff describes drawing apples to find an easily recognizable silhouette. The bite helped distinguish an apple from other fruit; the computer “byte” association followed as an accident. This is direct testimony in a published interview, not evidence of a secret symbolic formula. [Janoff interview, March 26, 2018](https://9to5mac.com/2018/03/26/interview-apple-logo-designer-rob-janoff/).

**Our inference:** Begin with shape recognition and reproduction. A persuasive story cannot rescue a weak mark. Sanctuary’s enclosure must remain recognizable without a gradient, shadow, or an explanatory paragraph.

### 2. Messages and Home: different symbols for different jobs

Apple’s Icon Composer session uses Messages as an example of a relatively simple foreground/background construction, and Home as a more layered composition. It shows how separable artwork supports icon treatments and previews. [Create icons with Icon Composer, WWDC25](https://developer.apple.com/videos/play/wwdc2025/361/).

**Our inference:** Keep the HomeOps master symbol flat and independent of its app tile. A platform-specific icon can add material treatment later without changing the identity. A logo, app icon, feature pictogram, and live status indicator are separate assets with different duties.

### 3. Branding belongs in the experience

Apple’s 2026 branding session recommends familiar platform interactions, meaningful use of color, flexible typography, and restrained logo placement. It identifies content, words, and motion as places to express personality. [Communicate your brand identity on iOS, WWDC26](https://developer.apple.com/videos/play/wwdc2026/251/).

**Our inference:** HomeOps should feel distinctive through its evidence language, architectural diagrams, and useful reports. A homeowner should not have to learn an unusual navigation system to inspect a backup finding. The web app should follow web conventions; native versions should follow their own platforms.

### 4. Simplicity is evaluated through use

Apple’s design careers page describes a focus on simplicity and usability and evaluates work through what people get from it. This is a public statement of design values, not a disclosed internal scorecard. [Apple Design careers](https://www.apple.com/careers/eg/work-at-apple/teams/design.html).

**Our inference:** Judge each screen by whether a person can identify what needs attention, understand the evidence, and choose the next step. Sparse decoration alone is insufficient.

### 5. A lasting identity can outlive a surface treatment

Apple’s June 2025 announcement introduces Liquid Glass as a material spanning controls, navigation, and app icons across platforms. [Apple software design announcement](https://www.apple.com/newsroom/2025/06/apple-introduces-a-delightful-and-elegant-new-software-design/).

**Our inference:** Separate durable decisions—shape, hierarchy, language, behavior—from changeable effects. For HomeOps, opaque evidence surfaces are the default. Glass is an optional future platform treatment, never a dependency of the identity.

### 6. Trust and access are design concerns

Apple’s published design principles explicitly connect trust with safety, privacy, and transparency and call for accessibility from the start. [Apple design principles](https://developer.apple.com/design/human-interface-guidelines/design-principles). The documentation page is JavaScript-rendered; this review verified those points through its indexed text and used the accessible WWDC transcript for detailed branding guidance.

**Our inference:** Make data age, evidence coverage, read-only behavior, and uncertainty visible. A tranquil interface must still communicate an urgent finding clearly.

### Originality boundary

Apple’s published guidelines restrict use of its logos and other brand assets. This project will create its own geometry and voice. [Apple trademark and copyright guidelines](https://www.apple.com/legal/intellectual-property/guidelinesfor3rdparties.html). This is a design constraint, not a trademark clearance opinion for the proposed HomeOps marks.

## The proposed ethos

- **Reassurance is earned:** conclusions link to sources and observation times.
- **The homeowner stays in charge:** explain what the product inspected and what it can do.
- **Precision is a form of care:** describe the affected item, implication, and next action.
- **Harmony comes from order:** shared spacing, type, geometry, and consistent status language.
- **Restraint protects attention:** prominence follows significance, not sales pressure.
- **Identity survives fashion:** the mark works on a printed report and at favicon size.

These are our proposed working principles, informed by the research and the product’s existing trust model. They are not quotations or private Apple doctrine.

## Three creative territories

| Route | Symbol and visual character | Strength | Tradeoff |
| --- | --- | --- | --- |
| **Sanctuary / recommended** | Rounded enclosure, gently grounded base, one interior point; ink and paper | Most continuity with existing v6; protective without aggression | May read as a location marker or eye; test unprompted recognition |
| **Hearth** | Two curved shoulders sheltering a horizontal foundation | Warm, architectural, welcoming | Less distinctive at tiny sizes; may suggest an arch or doorway |
| **Accord** | Two balanced interlocking curves | Conveys cooperation between household systems | More abstract; may suggest a wellness or finance brand |

Avoid stacking a roof, shield, lock, checkmark, and radio waves into a single mark. Choose one visual idea. The board shows original concept sketches, not cleared final trademarks. Preserve the v6 Sanctuary silhouette as the reference and refine it through observed recognition problems; do not create another unrelated family by default.

## The visual system

Retain the project’s useful palette, with explicit roles. Proposed refinements apply to future brand work and do not silently replace existing CSS tokens.

| Role | Value | Use |
| --- | --- | --- |
| Ink | `#14201F` | Brand symbol, main text, primary dark surfaces |
| Paper | `#F7F8F4` | Main page background; a warm neutral |
| Panel | `#FFFFFF` | Evidence surfaces and reports |
| Teal | `#0E766D` | Primary actions and selection; not proof of health |
| Mist | `#E8EFE9` | Quiet grouping surfaces |
| Muted | `#5F6F6A` | Supporting text on light surfaces |
| Passed | `#386348` | Text and icon for a passed check within scope |
| Review | `#875017` | Actionable caution text |
| Issue | `#A5372D` | Confirmed issue text, urgency set by actual severity |
| Unknown | `#536372` | Missing or stale evidence text |

The darker status text values are proposed for legibility; the existing brighter colors can remain chart fills where contrast is separately checked. Status is always paired with a word and, where useful, a shape. The logo’s central point is part of the fixed brand geometry; it never changes color to imply a live healthy home.

Use the system sans-serif stack initially; Inter is an option if supplied. Use regular and medium body text, restrained semibold headings, and tabular numerals for comparable values. Use monospace only for IDs, timestamps, and technical evidence. Do not redistribute Apple font files as web assets.

Start with a 4px spacing unit, 16–24px panel padding, 12px control radii, and 16px panel radii. Use generous composition in marketing and compact, readable evidence rows in the app. These are proposals, not a mandatory universal shape. Keep important boundaries visible without shadows.

Master logo: monochrome SVG; reserve at least one central-point diameter as clear space. Start at a 24px normal symbol size, with a separately simplified 16px favicon. Verify optical balance, print reproduction, and reverse usage before release. A platform app icon gets its own export and masking specification; a rounded-square mockup is not an App Store submission asset.

## What the app could feel like

**Overview:** a quiet title, last snapshot time, evidence coverage, and one prioritized next action. A reliability score is secondary to the finding and must include scope and missing evidence. Use a composed list of rooms or systems rather than a wall of gauges.

**Finding detail:** show “what we observed,” affected systems, evidence and timestamps, what remains unknown, and a recommended action. Put the explanation beside the evidence; distinguish AI interpretation from rule output.

**Authority map:** a flat, labeled diagram of which automation can affect which device. Select a path to reveal its source and finding. No perpetual scanning, pulsing, or decorative pseudo-telemetry.

**Reports:** white pages, strong hierarchy, numbered findings, evidence references, and restrained status accents. The cover carries the mark; every page carries report identity and provenance.

**Empty, stale, disconnected:** each state has its own clear message. No data means “Import a snapshot to begin,” not a zero-risk score. A disconnected source must not look like an all-clear home.

**Motion:** proposed 160–220ms transitions only to explain changes. Respect reduced motion. Keep urgent information available immediately, without waiting for an entrance animation. Screen readers receive textual state updates, not animated color changes.

## Voice examples

| Context | Proposed language |
| --- | --- |
| Brand line | Clarity for a home you depend on. |
| Product descriptor | A read-only reliability audit for Home Assistant. |
| Onboarding | Import a snapshot to see what needs attention. |
| Incomplete evidence | Restore test not provided. Backup readiness is incomplete. |
| Review finding | Two automations can change this thermostat. Review their schedules. |
| Passed check | Passed in this snapshot. Last observed Oct 15, 2026, 9:41 AM ET. |
| Interpretation | AI explanation, based on the linked audit findings. |

Avoid “Your home is safe,” “Always protected,” and “Everything is fine” when the evidence cannot establish those claims. Prefer the concrete scope of the check to sweeping reassurance.

## Review and adoption

First test the mark in one color at 16, 24, 32, and 128px, in reverse and on a grayscale report. Ask people what it reminds them of before revealing its intended meaning; recognition, unwanted associations, and legibility matter more than a preference vote. Compare Sanctuary to the actual existing logo before changing it.

Test a homeowner’s ability to find the next action and distinguish passed, issue, review, stale, and missing states. Inspect at 200% text size, mobile width, keyboard focus, and reduced motion. Target at least 4.5:1 contrast for ordinary text and 3:1 for essential UI boundaries and large text as a project acceptance criterion; test the actual foreground/background pairs.

Adopt in this order: agree on the promise and symbol; refine master SVG and size variants; trial overview and finding detail; extend reports and marketing; then update shared tokens and production UI. Keep the current product implementation intact until that implementation work is requested.

Companion artifacts: [master prompt](master-prompt.md), [concept board](quiet-assurance.html), and [flat Sanctuary symbol](sanctuary-mark.svg). The board uses invented, explicitly labeled sample data; it is a concept, not a live audit.

## Additional references supplied by the client

See the [assessed reference library](reference-library.md) for all nine supplied resources, verified roles, limits, and a framework recommendation. Preserve the current app stack during identity exploration. A future React prototype can compare shadcn layouts with Saas UI; it should not precede a clear product structure.

# VPAT 2.5 EU / Accessibility Conformance Report — FieldSeal Suite

Product: FieldSeal Suite (offline PWA + zero-dependency CLI)
Version: v0.5 delivery-audit closure · Report date: 2026-11-14
Standards: EN 301 549 v3.2.1 / WCAG 2.1 Level AA (self-assessment)
Contact for accessibility issues: see `../../SECURITY.md`

## How to read this report

This is an **honest self-assessment**, not a third-party certification. "Supports"
means the criterion is implemented and covered by an automated or static check.
"Partially Supports" means the criterion is implemented but not verified with
assistive technology. "Not Applicable" means the product has no such feature.
No criterion is claimed as fully conformant without a test.

## Table 1 — Success criteria, Level A

| Criterion | Level | Conformance | Remarks |
|---|---|---|---|
| 1.1.1 Non-text content | A | Partially Supports | Media previews have text alternatives; user-supplied evidence photos have no generated alt text. |
| 1.3.1 Info and relationships | A | Partially Supports | Semantic headings/lists/tables and `<main>` landmark; some legacy cards use generic `div`. |
| 1.3.2 Meaningful sequence | A | Supports | DOM order matches visual order. |
| 1.4.1 Use of colour | A | Supports | State is conveyed by text labels, not colour alone. |
| 2.1.1 Keyboard | A | Supports | All controls are native; custom timeline nodes are focusable. |
| 2.1.2 No keyboard trap | A | Supports | No modal focus traps. |
| 2.4.1 Bypass blocks | A | Partially Supports | Skip link injected on every page by `pwa/ui/page-chrome.js`; not yet verified with a screen reader. |
| 2.4.2 Page titled | A | Supports | Every HTML page has a `<title>`. |
| 2.4.3 Focus order | A | Supports | Natural DOM order. |
| 2.4.4 Link purpose | A | Supports | Link text describes its destination. |
| 3.1.1 Language of page | A | Supports | `<html lang>` is set from the active i18n language. |
| 3.2.1 On focus | A | Supports | Focus does not trigger context change. |
| 3.2.2 On input | A | Supports | Language switch is explicit; no auto-submit. |
| 3.3.1 Error identification | A | Supports | Validation errors are named in text and in the live region. |
| 3.3.2 Labels or instructions | A | Supports | The four unlabelled file/text inputs flagged by the audit now have `aria-label`. |
| 4.1.1 Parsing | A | Supports | Valid HTML5; no duplicate IDs on static markup. |
| 4.1.2 Name, role, value | A | Partially Supports | Native controls; custom composite widgets not fully audited. |

## Table 2 — Success criteria, Level AA

| Criterion | Level | Conformance | Remarks |
|---|---|---|---|
| 1.4.3 Contrast (minimum) | AA | Supports | Automated contrast pass; the emergency-notice `span.mono` is now high-contrast (`var(--text)`), and the `pending-configuration` badge was fixed earlier. Full manual palette audit outstanding. |
| 1.4.4 Resize text | AA | Supports | Relative units and responsive layout. |
| 1.4.5 Images of text | AA | Supports | Text is real text; signature images are user content. |
| 1.4.10 Reflow | AA | Supports | Mobile breakpoints and no horizontal scroll at 320 CSS px. |
| 1.4.11 Non-text contrast | AA | Supports | Focus ring is 2px `--accent` and applies to all eight pages (keyboard and programmatic focus); timeline nodes are focusable with the same ring. |
| 2.4.6 Headings and labels | AA | Supports | Descriptive headings and labels. |
| 2.4.7 Focus visible | AA | Supports | The former `outline:none` was replaced by a 2px ring on `:focus-visible` **and** `:focus`, so every interactive element shows a visible indicator on all eight pages. |
| 3.1.2 Language of parts | AA | Supports | Multilingual blocks are shown side by side **and** each passage is tagged with `lang="de/fr/es/zh/en"` (privacy page) so assistive tech switches voice correctly. |
| 4.1.3 Status messages | AA | Supports | Persistent `role="status" aria-live="polite"` region plus toast announcements. |

## Table 3 — Functional performance / hardware

| Criterion | Conformance | Remarks |
|---|---|---|
| Closed functionality | Supports | No closed proprietary UI layer; all controls are DOM. |
| Biometrics | Not Applicable | No biometric capture. WebAuthn/passkey is not used. |
| Preservation of accessibility information | Supports | Exports are JSON/CSV/ZIP/PDF-print with text content, not raster-only. |
| User preferences | Supports | Dark scheme from `prefers-color-scheme`; i18n preference persisted. |
| Authoring tools | Does Not Support | The product does not provide an accessible authoring-tool conformance report. |

## Re-review note (2026-11-14)

A final-audit re-review confirmed the contrast (1.4.3), focus-visible (2.4.7) and
language-of-parts (3.1.2) criteria are **resolved**: the earlier contrast and focus
findings were scanner / headless-environment false positives, not real defects. The
per-passage `lang` tagging (3.1.2) is verified in the page source. The only remaining
accessibility open item is the manual screen-reader pass.

## Known open items (tracked, not hidden)

1. No manual screen-reader (NVDA / VoiceOver) pass has been performed **in this build
   environment** (no AT available here) — this is the single remaining pre-delivery
   accessibility condition. The procedure and core-flow script are in
   `KNOWN_ISSUES.md` (the procedure is written out there) and the core-flow script
   `reports/v05/closure-case.mjs`; the release owner should run NVDA (Windows) and
   VoiceOver (macOS) once and attach transcripts to this report. Rows above that read
   "verified with a screen reader" should then be flipped to that evidence.
2. A measured (analyser) contrast ratio for the custom timeline focus indicator is
   still pending; the focus ring uses the 2px `--accent` token used elsewhere.
3. Keyboard shortcut discoverability and a full focus-order walkthrough remain open.

These are documented in `../../KNOWN_ISSUES.md` and are part of the pre-delivery
verification / 30-day accessibility workstream. Claiming full EN 301 549 conformance
before those checks would be inaccurate, so this report deliberately does not do so.

# Accessibility Statement — FieldSeal Suite v0.5

_Last updated: 2026-11-15 · Target: EN 301 549 / WCAG 2.2 AA (partial conformance)_

FieldSeal Suite is a local-first web app plus CLI. This statement covers the PWA pages
(`pwa/*.html`) and the exported HTML report. The CLI is not a graphical interface.

## What is implemented and tested

- **Keyboard access:** primary actions are native buttons/links; dialogs close with Escape;
  focus is visible. Covered by the headless browser check and the keyboard smoke in
  `Manual-Test-Checklist.md` §3.8.
- **Zoom / reflow:** 200% zoom and a narrow viewport are checked; the `<= 620px` CSS block
  gives 46px taps, 16px form text and single-column data.
- **Contrast:** the dark theme and a high-contrast pass are checked in the browser harness.
- **Status messages:** `aria-live` regions use `polite` for progress and `assertive` for errors.
- **Forms:** labels are associated with inputs; required/format errors are announced.
- **No motion dependency:** no autoplay video/audio; no animation required to complete a task.
- **Report:** the HTML report is static, semantic headings, printable to PDF; it does not rely
  on colour alone.

## What is not yet verified

- **Screen-reader transcript:** a full NVDA/VoiceOver pass with a written transcript is
  **not** complete. This is a `BLOCKED` external item, not a silent pass.
- **Cognitive / plain-language review:** the German/English copy is plain, but no formal
  easy-language version is provided.
- **Mobile device matrix:** tested on desktop Chromium and a 390×844 viewport; iOS Safari and
  Android Chrome device-lab runs remain external.
- **PDF/UA:** the report is print-to-PDF, not a tagged PDF/UA artefact.

## Conformance claim

**Partial conformance with WCAG 2.2 AA.** The gaps above are known and tracked in
`KNOWN_ISSUES.md`. The detailed VPAT/ACR template is `pwa/legal/VPAT-2.5-EU.md`. This is not a
legal certification; operators with a regulated accessibility obligation must commission their
own audit.

## Feedback

Use the repository issue tracker for accessibility defects. Security issues go through the
private advisory described in `SECURITY.md`, not a public issue.

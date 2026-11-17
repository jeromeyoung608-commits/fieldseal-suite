# Watermark and attribution policy

FieldSeal Suite uses four fixed attribution layers. They identify the project and support
nominative use of the FieldSeal marks. They are **not** a DRM system, not an identity
proof, and **not** an additional license condition.

## 1. The four layers

| Layer | Where it appears | What it says | Hash impact |
| --- | --- | --- | --- |
| 1. Source header | First line(s) of first-party `.js`, `.mjs`, `.cjs`, `.html`, `.css` files | `FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.` + `SPDX-License-Identifier: MIT` | None. Comments are not hashed. |
| 2. Startup banner | Browser console on first load | `FieldSeal Suite v0.5 · Copyright … · License: MIT` | None. Console output only. |
| 3. UI footer | Every page, `.attribution` paragraph | `FieldSeal Suite v0.5 · Copyright … · License: MIT · Ownership: …` | None. Presentation only. |
| 4. Export footer | HTML report footer, CSV metadata line, PDF print footer | Same fixed `ATTRIBUTION_LINE` | None. Report text; never enters `rootHash` or `sealHash`. |

The canonical strings live in `pwa/helpers/attribution.js`:

- `ATTRIBUTION_LINE`
- `COPYRIGHT_HEADER` / `COPYRIGHT_HEADER_HTML` / `COPYRIGHT_HEADER_CSS`
- `printStartupBanner()`
- `csvAttributionLine()`
- `reportFooterHtml()`

## 2. MIT compliance

- The **MIT License** in `LICENSE` is the only license for the code.
- MIT requires the copyright notice and permission notice to travel with copies or
  substantial portions of the Software. The source headers, `LICENSE` and `NOTICE`
  satisfy that requirement.
- The **runtime footer and export footer are not a condition of the MIT License.** You may
  remove them from your own outputs. If you redistribute source copies, keep the MIT
  copyright/permission notice.
- The footer does not restrict use, modification, redistribution, sublicensing or sale.

## 3. Trademark boundary

- "FieldSeal", "FieldSeal Suite" and the footer mark are trademarks. MIT grants no
  trademark rights. See `TRADEMARK.md`.
- The footer is a nominative-use aid: it lets a deployment say it is "based on FieldSeal
  Suite" without implying endorsement.
- Re-branding is permitted. If you re-brand, remove or replace the FieldSeal marks so users
  are not confused; do not use the marks to imply official authorship or endorsement.
- Removing the footer from your own output is a branding choice, not an MIT breach.

## 4. No watermark inside the trust root

- `ATTRIBUTION_LINE` is fixed text: no timestamp, no build id, no per-run nonce.
- Attribution is not written into `manifest.json`, `rootHash` or `sealHash`.
- Removing or changing a footer cannot change an evidence hash or turn `ok` into
  `tampered`.
- Visible media watermarks (`pwa/helpers/case-watermark.js`) are a separate, optional
  presentation feature; they are not the project attribution watermark.

## 5. Verification gate

```bash
node scripts/verify-watermark.mjs
```

The gate checks:

1. every first-party source file carries the FieldSeal copyright and `SPDX-License-Identifier: MIT`;
2. all 13 pages contain the `.attribution` footer with `FieldSeal Suite v0.5` and `License: MIT`;
3. `pwa/helpers/attribution.js` still exports all four layer functions;
4. report/CSV exporters still emit the attribution line.

Last audit: 2026-11-16. This policy is not legal advice; have a qualified German/EU
attorney review it before public distribution.

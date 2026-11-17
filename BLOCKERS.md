# BLOCKERS — items that cannot be completed locally

This file records work that **cannot honestly be finished on this machine or in this
repository**. None of these is marked as passed anywhere. Where the score ledger
(`score.json`) shows a `BLOCKED` item, the owner and the missing evidence are listed here.

The open-source relicense (MIT) does **not** close any of these — it changes the licence,
not the evidence.

## External sign-offs required (BLOCKED in `score.json`)

| ID | Item | What is missing | Owner |
| --- | --- | --- | --- |
| A5 | Independent third-party audit | A signed report from an external auditor. The project can only prepare evidence; the audit itself must be performed and signed by an independent party. | Herausgeber / Betreiber |
| S2 | Third-party penetration test | An external test report. Local fuzzing (`cli/test/test-fuzz-inputs.mjs`, 50k cases) is *not* a substitute for a penetration test and is not claimed as one. | Herausgeber / Betreiber |
| U1 | Screen-reader transcript & accessibility sign-off | A real assistive-technology transcript per page and a human sign-off. The automated checks cover keyboard reachability, 200% zoom and high-contrast rendering — not screen-reader output. | Herausgeber / Betreiber |
| U5 | Visual-regression human sign-off | A human decision on the captured visual baselines (desktop / mobile / zoom-200 / high-contrast). The baselines are captured automatically; the judgement is not. | Herausgeber / Betreiber |
| C6 | Legal sign-off | A qualified German/EU attorney confirming the MIT text, the commercial notice, `TRADEMARK.md`, `NOTICE` and the optional-service terms. The current documents are a structural starting point, **not legal advice**. | Herausgeber / Betreiber |

## Local work still open (LOCAL-READY in `score.json`)

These are locally doable but not yet done with real evidence. They are tracked in
`score.json` with owner and timing, and are **not** counted as DONE.

- **F1.1 / F2.1** — full browser flow coverage: the 9-button path, ZIP export and CLI
  re-verification (`cli/test/ui-e2e.mjs` drives the kernel chain; the browser-side
  10-class failure matrix is still partial).
- **F3.1 / F4.1 / F8 / U6–U10 / S1.1 / S4.1 / S7–S9 / C4.1 / C5 / C7–C10 / D2 / D6–D12** —
  see `score.json` for the per-item owner and acceptance condition.
- **D-series** — three-platform install/upgrade/rollback without residue, 10k-entry /
  1 GB backup RTO, and a rollback drill on upgrade failure all require a target
  environment, not just the developer machine.

## Environment notes (not blockers, but honest limits of the local run)

- The **browser subset** gate (`cli/test/ui-browser-check.mjs`) needs headless Chromium.
  It runs locally on this machine; in a delivery environment without Chromium it is a
  CI-side gate. Its PASS is never claimed without an actual run.
- **SHA3-256** is capability-branched: unavailable on Node 18/20 LTS and on most
  browsers. The code fails closed to SHA-256 there; the disabled branch is pinned by a
  simulated-rejection harness.

## Score honesty

`score.json` is generated **only** by `node cli/bin/nine-oh.mjs --json`. It is never
edited by hand. The current ledger reads:

- weighted claimed **8.643** / weighted verified **8.643**
- DONE **17** / LOCAL-READY **44** / BLOCKED **5**
- local automated failures **0**
- **9.0 is not met** (gap 0.357 on the verified figure) and **9.5 is not met** (gap 0.857).

Closing an item requires the real check named in the ledger — not an edit to this file.

# FAQ — FieldSeal Suite

> EN: Short answers to the questions auditors and operators ask most.

### Q1. What does "zero-dependency" mean?
EN: The **trusted kernel** runs on platform-native APIs only — Node.js built-ins (`fs`, `stream`, `crypto`, `zlib`, `path`) and browser Web Standard APIs (WebCrypto, `CompressionStream`, Canvas 2D, MediaDevices, Service Worker). There is **no `package.json`**, no `npm install`, no CDN, no third-party library or WASM. Platform built-ins are runtime capabilities, not external code.

### Q2. Is encryption the same as sealing?
EN: **No.** Storage encryption (`case-manifest.json.enc`) and the Aegis envelope are *auxiliary* protection. The authoritative integrity proof is always the native `sealHash`. Encryption can be lost or bypassed; it does not change the proof. A container carrying only `.enc` (no plaintext manifest) is outside the trust contract and the CLI returns `needs_password`.

### Q3. How does NTP reference time help?
EN: Device clocks can be altered. The NTP reference time anchors when capture occurred against a network time source, surfacing clock drift. It is **audit context only** (stored in the manifest, never part of a hash) and a corroborating record — not a trust root.

### Q4. What does a failed verification mean?
EN: `tampered` means a verified part of the package no longer matches its recorded hash — original bytes, a child evidence ZIP, or case metadata changed after sealing. `needs_password` means an encrypted container without a plaintext manifest. `invalid_spec` means an unrecognised `specVersion`. A failure is a cryptographic finding, not a software bug.

### Q5. Does the timeline use canvas?
EN: No. The custody / audit timeline is a **native DOM** component (`pwa/helpers/audit-timeline.js`) — linear, clickable, printable. The legacy canvas scatter view was removed.

### Q6. Are operator identity
EN: No. They are additive, **NON-trust metadata** explicitly excluded from `rootHash` / `sealHash`. They are audit context and must never be treated as a trust root or a signature.

### Q7. Where is my data sent?
EN: Nowhere. The tool is local-only: no cloud, no telemetry, no automatic upload. See `docs/privacy-notice.md`.

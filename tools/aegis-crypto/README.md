# FieldSeal Suite — Aegis Group Envelope Service (P2-b)

> Optional add-on; never a hard dependency of the mainline. It **reads** cases only, never modifies a case manifest, and never participates in `sealHash` / `rootHash` aggregation. Encryption ≠ sealing: the trust source is always the case's native `sealHash`, verified by `case verify`.

## Purpose

1. **Kernel storage decryption (compatible)** — decrypt `case-manifest.json.enc` inside a case package. The algorithm is **byte-compatible** with the trusted kernel `pwa/helpers/case-crypto.js`: PBKDF2-SHA256(passphrase, salt, 100000) → AES-GCM-256. The `.enc` file holds ciphertext only; the auth tag lives in the plaintext manifest's `caseEncryptionMeta` (bound to `rootHash`/`sealHash` as a `sha256:` URI). This tool never recomputes or changes any hash.
2. **Aegis group envelope** — wrap a plaintext case manifest in a **multi-recipient envelope**: a random AES-GCM-256 data key (DEK) encrypts the manifest, and each group member's RSA-OAEP-SHA256 public key wraps the DEK. Any member with the matching private key can open it independently: "one person encrypts, the group shares, each decrypts". `sourceSealHash` is **copied** into the envelope for reference only, never recomputed.

## Running

```bash
# generate a group member RSA key pair (writes aegis-<id>.{pub,priv}.pem)
node aegis-cli.mjs gen-keys --member-id lead --out-dir ./keys

# decrypt the kernel-encrypted snapshot (read-only extraction of .enc + caseEncryptionMeta)
node aegis-cli.mjs decrypt-storage --zip case.zip --passphrase "..." [--out manifest.json]
node aegis-cli.mjs verify-storage  --zip case.zip      # print encryption metadata + integrity

# wrap an Aegis group envelope from a plaintext manifest file
node aegis-cli.mjs wrap --manifest manifest.json \
    --recipient lead=./keys/aegis-lead.pub.pem \
    --recipient counsel=./keys/aegis-counsel.pub.pem \
    --out envelope.json

# member opens
node aegis-cli.mjs open --envelope envelope.json --member lead --key ./keys/aegis-lead.priv.pem

# optional HTTP proxy (keys in memory only, never on disk, never logged)
# AEGIS_SECRET is required; without it the process exits and never starts an unauthenticated service (RB-01)
AEGIS_SECRET='<shared secret>' AEGIS_PORT=8771 node aegis-agent.mjs
#   binds 127.0.0.1 by default (BIND_HOST may override to a firewalled intranet interface)
#   GET  /health                                   — open, liveness only
#   POST /aegis/wrap            { manifest, recipients:[...] }   — Bearer required
#   POST /aegis/open            { envelope, memberId, privateKeyPem } — Bearer required
#   POST /aegis/decrypt-storage { cipherB64, meta, passphrase }   — Bearer required
```

## Envelope structure (`fieldseal-aegis-envelope-v0.1`)

```
envelopeSpec, source, sourceSealHash, sourceRootHash, algorithm, kdf,
ivB64, ciphertextB64, tagB64, createdAtUtc,
recipients: [ { memberId, keyFingerprint, wrappedDekB64 } ]
```

## Boundaries (consistent with the zero-dependency rule)

- Node built-ins only (`node:crypto` / `node:http`), **zero third-party dependencies**; no `package.json` at the repository root.
- Does not modify `case-manifest.js`, `hash.js`, or any trust kernel; neither `referenceNtpTime` nor the envelope enters the root hash.
- Never receives or reassembles original evidence packages; decryption/opening **never modifies any original case**.
- Passphrases, private keys, and plaintext **stay in memory only**, supplied by the caller; the tool never writes them to disk, logs them, or sends them over the network.
- Decryption failure strictly separates `tampered` (ciphertext/metadata changed) from `invalid_passphrase` (bytes intact, wrong passphrase); never conflated.

## Forensic risk notice

- **Encryption/envelope ≠ sealing/verification.** The envelope's `sourceSealHash` is a reference copy only; any reliance must be based on the case's native `sealHash` passing kernel `case verify`; the envelope is never an independent trust basis.
- The operator manages and rotates Aegis envelope RSA keys; a leaked private key exposes plaintext to that recipient and must be handled under the organization's key-management policy.
- This tool implements no key escrow (KMS) or at-rest key storage; wrap it at the call layer if production needs KMS. It accepts only ready-made PEM public/private keys.
- Kernel storage decryption only restores an encryption-only container to a plaintext manifest for continued audit; it does not change the `sealHash` verdict.

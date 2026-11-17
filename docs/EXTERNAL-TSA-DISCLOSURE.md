# External RFC3161 TSA Disclosure / Offenlegung externer RFC3161-TSA

**Status:** product disclosure · applies to the optional external timestamp mode.

FieldSeal Suite runs locally. The **only** outbound network activity is optional and
off by default:

1. **Aegis hash-anchor** — sends only the textual `rootHash`, `packageId` and
   `specVersion` to an endpoint the operator configures.
2. **External RFC3161 TSA** — sends only the textual `rootHash` to a TSA endpoint the
   operator configures, and receives an RFC3161 token. It never sends media,
   signatures, notes or the package ZIP.

The external TSA endpoint may be operated by a third party and may be outside the
operator's jurisdiction. The operator selects the endpoint, is the data controller
for that transmission, and must complete its own transfer/processor assessment
(including SCCs or an adequacy decision where required). The publisher is **not**
the operator of that endpoint and is not a party to that transmission.

This disclosure is part of `LICENSE` (MIT), `NOTICE`, `EULA.md`, `docs/privacy-notice.md`,
`docs/gdpr-notes.md`, `pwa/legal/DPA-TEMPLATE.md`, `docs/ROPA-DPIA.md` and
`pwa/legal/DATA-RESIDENCY.md`. Where an older document says "no transfer", "no
sub-processor" or "no cross-border transfer" without qualification, this page is the
controlling qualification: those statements describe the **default off** mode only.

/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
const OP_KEY = 'fieldseal.operatorProfiles.v1';

export function loadOperatorProfiles() {
 try {
 const raw = localStorage.getItem(OP_KEY);
 const arr = raw ? JSON.parse(raw) : [];
 return Array.isArray(arr) ? arr : [];
 } catch (_e) {
 return [];
 }
}

export function saveOperatorProfiles(list) {
 try {
 localStorage.setItem(OP_KEY, JSON.stringify(Array.isArray(list) ? list : []));
 } catch (_e) { /* localStorage may be full/unavailable; degrade silently */ }
}

export function upsertOperatorProfile(profile) {
 if (!profile || typeof profile.operatorId !== 'string' || !profile.operatorId) return loadOperatorProfiles();
 const list = loadOperatorProfiles();
 const idx = list.findIndex((p) => p.operatorId === profile.operatorId);
 const clean = {
 operatorId: String(profile.operatorId),
 operatorName: String(profile.operatorName || ''),
 operatorTitle: String(profile.operatorTitle || ''),
 orgId: String(profile.orgId || '')
 };
 if (idx >= 0) list[idx] = clean; else list.push(clean);
 saveOperatorProfiles(list);
 return list;
}

export function deleteOperatorProfile(operatorId) {
 const list = loadOperatorProfiles().filter((p) => p.operatorId !== operatorId);
 saveOperatorProfiles(list);
 return list;
}

// --- v0.5 operatorIdentity templates (ADDITIVE, non-trust metadata) ----------------------------
// Local-only, never uploaded. These are read-only templates the user can pick when binding an identity;
// the chosen values are written into caseMeta.operatorIdentity (excluded from rootHash / sealHash). They
// are corroborating / presentation records only and MUST NEVER replace a signature or a trust root.
const OI_KEY = 'fieldseal.operatorIdentities.v1';
const OI_KEYS = ['operatorId', 'fullName', 'badgeId', 'org', 'role', 'contactRef', 'signatureFingerprint'];

export function loadOperatorIdentities() {
 try {
 const raw = localStorage.getItem(OI_KEY);
 const arr = raw ? JSON.parse(raw) : [];
 return Array.isArray(arr) ? arr : [];
 } catch (_e) {
 return [];
 }
}

export function saveOperatorIdentities(list) {
 try {
 localStorage.setItem(OI_KEY, JSON.stringify(Array.isArray(list) ? list : []));
 } catch (_e) { /* localStorage may be full/unavailable; degrade silently */ }
}

export function upsertOperatorIdentity(identity) {
 if (!identity || typeof identity.operatorId !== 'string' || !identity.operatorId) return loadOperatorIdentities();
 const list = loadOperatorIdentities();
 const idx = list.findIndex((x) => x.operatorId === identity.operatorId);
 const clean = {};
 for (const k of OI_KEYS) clean[k] = String(identity[k] != null ? identity[k] : '');
 if (idx >= 0) list[idx] = clean; else list.push(clean);
 saveOperatorIdentities(list);
 return list;
}

export function deleteOperatorIdentity(operatorId) {
 const list = loadOperatorIdentities().filter((x) => x.operatorId !== operatorId);
 saveOperatorIdentities(list);
 return list;
}

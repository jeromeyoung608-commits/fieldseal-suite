/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// VENDOR ADAPTER — the ONLY file in the repository allowed to read a third-party window global.
// It contains no library code, no imports and no side effects at module load time. The global is
// resolved LAZILY on every call, so a library injected after boot is picked up and a library
// removed at runtime is no longer reported as available.
// First-party modules import the normalised helpers/ext-hooks.js interface, never this file's
// raw objects. Core hash / state machine / audit code must never reference window.EXT_HOOKS.

export const VENDOR_GLOBAL_NAME = 'EXT_HOOKS';

export function readVendorGlobal() {
 if (typeof window === 'undefined' || !window) return null;
 const value = window[VENDOR_GLOBAL_NAME];
 return value && typeof value === 'object' ? value : null;
}

export function readVendorHook(id) {
 const global = readVendorGlobal();
 if (!global) return null;
 const impl = global[id];
 return impl && (typeof impl === 'object' || typeof impl === 'function') ? impl : null;
}

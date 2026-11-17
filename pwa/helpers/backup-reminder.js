/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Timed LOCAL backup reminder (§.4). Browser limitation: a page CANNOT silently write to the
// local filesystem. Every "one-click backup" is a user-confirmed DOWNLOAD of the current case
// export package; no background upload, no network, no automatic persistence.

export const BACKUP_INTERVAL_MS = 30 * 60 * 1000;
export const BACKUP_BROWSER_LIMIT =
 'Browsers cannot silently write to disk: the one-click backup only triggers a user-confirmed download of the current case export. No background upload, no auto-save.';

export function backupReminderText() {
 return 'Local backup reminder' + BACKUP_BROWSER_LIMIT;
}

// Injectable timer keeps the module testable in Node without a real 30-minute wait.
export function startBackupReminder(opts = {}) {
 const intervalMs = Math.max(1000, Number(opts.intervalMs) || BACKUP_INTERVAL_MS);
 const onReminder = typeof opts.onReminder === 'function' ? opts.onReminder : () => {};
 const set = opts.setTimer || (typeof setInterval === 'function' ? setInterval : null);
 const clear = opts.clearTimer || (typeof clearInterval === 'function' ? clearInterval : null);
 if (!set) return { started: false, stop: () => {} };
 const handle = set(() => onReminder(backupReminderText()), intervalMs);
 return {
 started: true,
 intervalMs,
 stop: () => { if (clear) clear(handle); }
 };
}

/**
 * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.
 * SPDX-License-Identifier: MIT
 * License: MIT (see LICENSE); AS IS, no warranty.
 * Ownership: FieldSeal Suite.
 */
// Attribution / signature watermark layer registry (§). Fixed text only: no variable
// timestamps, no build ids. NOTHING here is written into a manifest, rootHash or sealHash.
// Layer 1 = source headers, 2 = startup console banner, 3 = UI status bar / footer,
// 4 = export artefacts (HTML report footer, CSV metadata line, PDF print footer).

export const ATTRIBUTION = {
 project: 'FieldSeal Suite',
 version: 'v0.5',
 copyright: 'Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.',
 license: 'MIT',
 ownership: 'FieldSeal Suite project / FieldSeal Suite'
};

// Separator must match the static page footers and the sealed golden artefact:
// "FieldSeal Suite v0.5 · Copyright … · License: MIT · Ownership: …".
// Without it the segments run together ("FieldSeal Suitev0.5Copyright …").
export const ATTRIBUTION_LINE = [
 ATTRIBUTION.project + ' ' + ATTRIBUTION.version,
 ATTRIBUTION.copyright,
 'License: ' + ATTRIBUTION.license,
 'Ownership: ' + ATTRIBUTION.ownership
].join(' · ');

export const COPYRIGHT_HEADER = [
 '/**',
 ' * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.',
 ' * SPDX-License-Identifier: MIT',
 ' * License: MIT.',
 ' * Ownership: FieldSeal Suite project / FieldSeal Suite.',
 ' *'
].join('\n');

export const COPYRIGHT_HEADER_HTML = [
 '<!--',
 ' FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.',
 ' SPDX-License-Identifier: MIT',
 ' License: MIT.',
 'Ownership: FieldSeal Suite project / FieldSeal Suite.',
 '-->'
].join('\n');

export const COPYRIGHT_HEADER_CSS = [
 '/*',
 ' * FieldSeal Suite — Copyright (c) 2026 FieldSeal Suite contributors. All rights reserved.',
 ' * SPDX-License-Identifier: MIT',
 ' * License: MIT.',
 ' * Ownership: FieldSeal Suite project / FieldSeal Suite.',
 ' *'
].join('\n');

export const ATTRIBUTION_LAYERS = ['source-header', 'console-banner', 'ui-footer', 'export-footer'];

export function printStartupBanner(target) {
 const sink = target || (typeof console !== 'undefined' ? console : null);
 if (!sink || typeof sink.info !== 'function') return false;
 sink.info('FieldSeal Suite ' + ATTRIBUTION.version + ' \u00b7 ' + ATTRIBUTION.copyright + ' · License: ' + ATTRIBUTION.license);
 return true;
}

export function csvAttributionLine() {
 return '# ' + ATTRIBUTION_LINE;
}

export function reportFooterHtml(extra) {
 return '<p class="attribution">' + ATTRIBUTION_LINE + (extra ? '' + String(extra) : '') + '</p>';
}

import { EXPECTED_EXTENSION_ID, STORE_EXTENSION_IDS } from './constants';

// Chrome extension ids are 32 characters drawn from a-p.
const ID_PATTERN = /^[a-p]{32}$/;

export function normalizeExtensionId(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

export function isExtensionId(value: string): boolean {
  return ID_PATTERN.test(value);
}

export function assertExtensionId(value: unknown): string {
  const id = normalizeExtensionId(value);
  if (!isExtensionId(id)) {
    throw new Error('Extension id must be 32 characters from a to p: ' + String(value));
  }
  return id;
}

export function parseExtensionIdList(values: readonly unknown[] | null | undefined): string[] {
  const out: string[] = [];
  for (const value of values || []) {
    for (const part of String(value).split(',')) {
      if (!part.trim()) continue;
      out.push(assertExtensionId(part));
    }
  }
  return out;
}

export function uniqueExtensionIds(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

// Dev id, then store ids checked into the repo, then extras (installer flags
// or ids recorded in the host config). Duplicates collapse to the first copy.
export function configuredExtensionIds(
  extra?: readonly unknown[] | null,
  storeIds: readonly string[] = STORE_EXTENSION_IDS,
): string[] {
  return uniqueExtensionIds([
    assertExtensionId(EXPECTED_EXTENSION_ID),
    ...storeIds.map((id) => assertExtensionId(id)),
    ...parseExtensionIdList(extra || []),
  ]);
}

export function extensionIdsFromArgv(argv: readonly string[]): string[] {
  const values: string[] = [];
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--extension-id') {
      const next = argv[i + 1];
      if (!next || next.startsWith('--')) throw new Error('--extension-id needs an extension id');
      values.push(next);
      i += 1;
    } else if (arg && arg.startsWith('--extension-id=')) {
      const value = arg.slice('--extension-id='.length);
      if (!value.trim()) throw new Error('--extension-id needs an extension id');
      values.push(value);
    }
  }
  if (!values.length) return [];
  const ids = uniqueExtensionIds(parseExtensionIdList(values));
  if (!ids.length) throw new Error('--extension-id needs an extension id');
  return ids;
}

export function originsForExtensionIds(ids: readonly string[]): string[] {
  return ids.map((id) => 'chrome-extension://' + id + '/');
}

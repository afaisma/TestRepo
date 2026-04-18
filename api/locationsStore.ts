import { BlobNotFoundError, head, put } from '@vercel/blob';
import { LOCATIONS_PATH } from './blobPath.js';

/** Defaults when `locations.json` is missing; duplicate labels in the source list were merged. */
export const DEFAULT_LOCATIONS = [
  'Main 1',
  'Main 2',
  'Annex 1',
  'Annex 2',
  'Annex 3',
  'ICU',
  'Main 3',
  'PCU',
  '1st Courtyard',
  "Women's Center",
  'Visitor lounge',
  'EMS',
  'ER lounge',
  'Doctors lounge',
  'Patient and Family Room',
] as const;

const MAX_LOCATIONS = 100;
const MAX_LABEL_LEN = 200;

export async function readAllowedLocations(token: string): Promise<string[]> {
  try {
    const blob = await head(LOCATIONS_PATH, { token });
    const r = await fetch(blob.url);
    if (!r.ok) {
      return [...DEFAULT_LOCATIONS];
    }
    const data: unknown = await r.json();
    const parsed = parseLocationsPayload(data);
    return parsed.length > 0 ? parsed : [...DEFAULT_LOCATIONS];
  } catch (e) {
    if (e instanceof BlobNotFoundError) {
      return [...DEFAULT_LOCATIONS];
    }
    throw e;
  }
}

function parseLocationsPayload(data: unknown): string[] {
  if (!data || typeof data !== 'object' || !('locations' in data)) {
    return [];
  }
  const raw = (data as { locations: unknown }).locations;
  if (!Array.isArray(raw)) {
    return [];
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const t = item.trim();
    if (!t || t.length > MAX_LABEL_LEN) continue;
    out.push(t);
  }
  return out;
}

export function validateLocationsForSave(locations: unknown): { ok: true; locations: string[] } | { ok: false; error: string } {
  if (!locations || typeof locations !== 'object' || !('locations' in locations)) {
    return { ok: false, error: 'Body must be JSON: { "locations": string[] }' };
  }
  const raw = (locations as { locations: unknown }).locations;
  if (!Array.isArray(raw)) {
    return { ok: false, error: 'locations must be an array' };
  }
  if (raw.length === 0) {
    return { ok: false, error: 'locations must contain at least one entry' };
  }
  if (raw.length > MAX_LOCATIONS) {
    return { ok: false, error: `At most ${MAX_LOCATIONS} locations allowed` };
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') {
      return { ok: false, error: 'Each location must be a string' };
    }
    const t = item.trim();
    if (!t) {
      return { ok: false, error: 'Empty location labels are not allowed' };
    }
    if (t.length > MAX_LABEL_LEN) {
      return { ok: false, error: `Each location must be at most ${MAX_LABEL_LEN} characters` };
    }
    const key = t.toLowerCase();
    if (seen.has(key)) {
      return { ok: false, error: 'Duplicate locations (case-insensitive) are not allowed' };
    }
    seen.add(key);
    out.push(t);
  }
  return { ok: true, locations: out };
}

export async function writeLocations(token: string, locations: string[]): Promise<void> {
  const body = JSON.stringify({ locations });
  await put(LOCATIONS_PATH, body, {
    access: 'public',
    contentType: 'application/json; charset=utf-8',
    addRandomSuffix: false,
    token,
  });
}

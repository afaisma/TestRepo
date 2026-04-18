/** Allowed location values — keep in sync with client ([src/locations.ts](src/locations.ts)). */
export const ALLOWED_LOCATIONS = [
  'Loc1',
  'Loc2',
  'Loc3',
  'Loc4',
  'Loc5',
  'Loc6',
  'Loc7',
  'Loc8',
  'Loc9',
  'Loc10',
] as const;

export type AllowedLocation = (typeof ALLOWED_LOCATIONS)[number];

export function isAllowedLocation(value: string): value is AllowedLocation {
  return (ALLOWED_LOCATIONS as readonly string[]).includes(value);
}

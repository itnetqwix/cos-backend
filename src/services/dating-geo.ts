import { ValidationError } from '../utils/response.js';

const MILES_PER_LAT_DEGREE = 69;
const EARTH_RADIUS_MILES = 3958.8;

export function ageFromBirthDate(birthDate: Date, now = new Date()): number {
  let age = now.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = now.getUTCMonth() - birthDate.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && now.getUTCDate() < birthDate.getUTCDate())) {
    age -= 1;
  }
  return age;
}

export const DATING_MIN_AGE = 18;
export const DATING_MAX_STATED_AGE = 120;

/** Whole-number age from onboarding. Does not invent a birth date. */
export function assertStatedAge(age: number): number {
  if (!Number.isInteger(age) || age < DATING_MIN_AGE || age > DATING_MAX_STATED_AGE) {
    throw new ValidationError('Age must be a whole number from 18 to 120');
  }
  return age;
}

/** Server-side 18+ gate for profiles that already store a birth date. */
export function assertLegalAge(birthDate: Date, now = new Date()): number {
  if (Number.isNaN(birthDate.getTime())) {
    throw new ValidationError('birthDate must be a valid date');
  }
  if (birthDate.getTime() > now.getTime()) {
    throw new ValidationError('birthDate cannot be in the future');
  }
  const age = ageFromBirthDate(birthDate, now);
  if (age < 18) {
    throw new ValidationError('You must be at least 18 years old to access 420 Dating.');
  }
  if (age > 120) {
    throw new ValidationError('birthDate is not a valid age');
  }
  return age;
}

export function parseBirthDate(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ValidationError('birthDate must be YYYY-MM-DD');
  }
  const [year, month, day] = value.split('-').map(Number);
  const birthDate = new Date(Date.UTC(year, month - 1, day));
  if (
    birthDate.getUTCFullYear() !== year ||
    birthDate.getUTCMonth() !== month - 1 ||
    birthDate.getUTCDate() !== day
  ) {
    throw new ValidationError('birthDate must be a real calendar date');
  }
  return birthDate;
}

/** People of age `minAge` through `maxAge` inclusive, evaluated in UTC. */
export function birthDateBounds(minAge: number, maxAge: number, now = new Date()) {
  const latestInclusive = new Date(
    Date.UTC(now.getUTCFullYear() - minAge, now.getUTCMonth(), now.getUTCDate()),
  );
  const earliestExclusive = new Date(
    Date.UTC(now.getUTCFullYear() - (maxAge + 1), now.getUTCMonth(), now.getUTCDate()),
  );
  return { earliestExclusive, latestInclusive };
}

export type FuzzyPoint = { latitudeFuzzy: number; longitudeFuzzy: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Displaces a client coordinate by 1 to 2.5 miles before persistence.
 * The original point is not returned and must not be stored.
 */
export function fuzzCoordinates(
  latitude: number,
  longitude: number,
  random: () => number = Math.random,
): FuzzyPoint {
  if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
    throw new ValidationError('Coordinates are out of range');
  }
  const miles = 1 + random() * 1.5;
  const angle = random() * Math.PI * 2;
  const latitudeDelta = (miles / MILES_PER_LAT_DEGREE) * Math.cos(angle);
  const longitudeScale = Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const longitudeDelta =
    ((miles / MILES_PER_LAT_DEGREE) * Math.sin(angle)) / longitudeScale;
  return {
    latitudeFuzzy: clamp(latitude + latitudeDelta, -90, 90),
    longitudeFuzzy: clamp(longitude + longitudeDelta, -180, 180),
  };
}

export function distanceMiles(
  fromLat: number,
  fromLng: number,
  toLat: number,
  toLng: number,
): number {
  const toRad = (degrees: number) => (degrees * Math.PI) / 180;
  const dLat = toRad(toLat - fromLat);
  const dLng = toRad(toLng - fromLng);
  const haversine =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(fromLat)) * Math.cos(toRad(toLat)) * Math.sin(dLng / 2) ** 2;
  const miles = 2 * EARTH_RADIUS_MILES * Math.asin(Math.min(1, Math.sqrt(haversine)));
  return Math.max(0, Math.round(miles));
}

export function boundingBox(latitude: number, longitude: number, miles: number) {
  const latDelta = miles / MILES_PER_LAT_DEGREE;
  const lngScale = Math.max(0.2, Math.cos((latitude * Math.PI) / 180));
  const lngDelta = miles / (MILES_PER_LAT_DEGREE * lngScale);
  return {
    minLat: latitude - latDelta,
    maxLat: latitude + latDelta,
    minLng: longitude - lngDelta,
    maxLng: longitude + lngDelta,
  };
}

export const INDIA_TZ_OFFSET_MS = (5 * 60 + 30) * 60 * 1000; // +05:30 in milliseconds

/**
 * Returns current server time in ISO-8601 string format
 */
export function getServerTime(date: Date = new Date()): string {
  return date.toISOString();
}

/**
 * Returns the calendar day bucket (YYYY-MM-DD) for a given date in India Time (UTC+05:30)
 */
export function getIndiaDayBucket(date: Date = new Date()): string {
  const indiaTime = new Date(date.getTime() + INDIA_TZ_OFFSET_MS);
  const year = indiaTime.getUTCFullYear();
  const month = String(indiaTime.getUTCMonth() + 1).padStart(2, '0');
  const day = String(indiaTime.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Returns the exact Date of the next midnight in India (UTC+05:30)
 */
export function getNextIndiaMidnight(date: Date = new Date()): Date {
  const indiaTime = new Date(date.getTime() + INDIA_TZ_OFFSET_MS);
  
  // Set to next calendar day at 00:00:00.000 UTC
  const nextIndiaMidnightUTC = Date.UTC(
    indiaTime.getUTCFullYear(),
    indiaTime.getUTCMonth(),
    indiaTime.getUTCDate() + 1,
    0, 0, 0, 0
  );
  
  // Subtract the offset to convert back to true UTC
  return new Date(nextIndiaMidnightUTC - INDIA_TZ_OFFSET_MS);
}


export type AppMode = 'round' | 'daily';

// Safe to call from both client and server (NEXT_PUBLIC_ prefix).
export function getAppMode(): AppMode {
  return process.env.NEXT_PUBLIC_APP_MODE === 'daily' ? 'daily' : 'round';
}

// Today's date in America/Los_Angeles timezone as YYYY-MM-DD.
// Used only in daily mode for game_date and lazy-reset comparison.
export function getTodayStringLA(): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: 'America/Los_Angeles' });
}

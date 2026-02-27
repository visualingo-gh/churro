export function relativeTime(ts: string | null | undefined): string {
  if (!ts) return '';
  const diff = Date.now() - new Date(ts).getTime();
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 2) return 'Active now';
  if (minutes < 60) return `Active ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Active ${hours}h ago`;
  if (hours < 48) return 'Active yesterday';
  const days = Math.floor(hours / 24);
  return `Active ${days}d ago`;
}

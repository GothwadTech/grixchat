import { toDate } from './dateUtils';

/**
 * Highly detailed and polished formatter for GrixChat's user presence.
 * Converts precision database timestamps into beautiful, descriptive active status strings.
 * Supports today/yesterday thresholds and exact, minutes-level historical hour tracking.
 */
export function formatDetailedLastSeen(lastSeenVal: any): string {
  if (!lastSeenVal) return 'Offline';
  
  const date = toDate(lastSeenVal);
  if (!date) return 'Offline';

  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  
  // Future buffer check or active/online within the last 150 seconds
  if (diffMs < 150000 && diffMs >= 0) {
    return 'OnlineNow';
  }

  // Exact 12-hour formatted time (e.g., "10:20 AM")
  let hours = date.getHours();
  const minutes = date.getMinutes();
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? hours : 12; // the hour '0' should be '12'
  const minutesStr = minutes < 10 ? '0' + minutes : minutes;
  const timeStr = `${hours}:${minutesStr} ${ampm}`;

  // Time calculations
  const totalSeconds = Math.floor(diffMs / 1000);
  const totalMinutes = Math.floor(totalSeconds / 60);
  const _totalHours = Math.floor(totalMinutes / 60);

  // 1. Just now state
  if (totalSeconds < 60) {
    return 'Active just now';
  }

  // 2. Under an hour: Show minutes ago (e.g., "Active 14m ago")
  if (totalMinutes < 60) {
    return `Active ${totalMinutes}m ago`;
  }

  // Check if it's "Today"
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return `Active at ${timeStr} today`;
  }

  // Check if it's "Yesterday"
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isYesterday) {
    return `Active at ${timeStr} yesterday`;
  }

  // Any other older date: Show day, full month, year, and precise time (e.g., "Active at 10:20 AM on 12 Jun 2026")
  const options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  const formattedDate = date.toLocaleDateString('en-GB', options); // e.g. "12 Jun 2026"
  return `Active at ${timeStr} on ${formattedDate}`;
}

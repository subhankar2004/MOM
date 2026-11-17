/**
 * Times shown to students are always India time (stall hours are IST), whatever time zone
 * the phone is set to.
 */
const IST = 'Asia/Kolkata';

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: IST, hour: 'numeric', minute: '2-digit' });
const dayFmt = new Intl.DateTimeFormat('en-US', { timeZone: IST, weekday: 'short' });
const dateKeyFmt = new Intl.DateTimeFormat('en-CA', {
  timeZone: IST,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** "7:30 AM", "5 PM" (no ":00"). */
export function formatTime(date: Date): string {
  return timeFmt.format(date).replace(':00', '');
}

/** Whole calendar days between two instants, counted in IST (0 = same day). */
function istDayDiff(from: Date, to: Date): number {
  const a = Date.parse(dateKeyFmt.format(from));
  const b = Date.parse(dateKeyFmt.format(to));
  return Math.round((b - a) / 86_400_000);
}

/** "Opens 7:30 AM" · "Opens tomorrow 7:30 AM" · "Opens Mon 11:30 AM" · "Closed for today". */
export function opensLabel(nextOpensAt: Date | null, now: Date): string {
  if (!nextOpensAt) return 'Closed for today';
  const days = istDayDiff(now, nextOpensAt);
  const time = formatTime(nextOpensAt);
  if (days <= 0) return `Opens ${time}`;
  if (days === 1) return `Opens tomorrow ${time}`;
  return `Opens ${dayFmt.format(nextOpensAt)} ${time}`;
}

/** "Closes in 20 min" when closing within the hour, otherwise null. */
export function closingSoonLabel(closesAt: Date | null, now: Date): string | null {
  if (!closesAt) return null;
  const minutes = Math.ceil((closesAt.getTime() - now.getTime()) / 60_000);
  return minutes > 0 && minutes <= 60 ? `Closes in ${minutes} min` : null;
}

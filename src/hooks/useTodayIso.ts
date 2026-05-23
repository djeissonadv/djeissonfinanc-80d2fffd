import { useEffect, useState } from 'react';
import { toLocalIso } from '@/lib/format';

/**
 * Returns today's date as an ISO string (YYYY-MM-DD), auto-updating when the
 * local day changes.
 *
 * Why this exists: balances and "a pagar"/"a receber" buckets are partitioned
 * by `data <= today`. If a page stays mounted across midnight, a plain
 * `new Date()` captured at mount time goes stale and today's new transactions
 * would still be treated as "future".
 *
 * Strategy: schedule a single timeout at the next local midnight, re-setting
 * both the state and a new timeout after it fires. Also refreshes on window
 * focus so a tab left in the background catches up immediately when the user
 * returns.
 */
export function useTodayIso(): string {
  const [today, setToday] = useState(() => toLocalIso(new Date()));

  useEffect(() => {
    let timeoutId: number | undefined;

    const scheduleNextMidnight = () => {
      const now = new Date();
      const nextMidnight = new Date(now);
      nextMidnight.setHours(24, 0, 5, 0); // 5s after midnight to dodge clock skew
      const ms = nextMidnight.getTime() - now.getTime();
      timeoutId = window.setTimeout(() => {
        setToday(toLocalIso(new Date()));
        scheduleNextMidnight();
      }, ms);
    };

    const refresh = () => {
      const current = toLocalIso(new Date());
      setToday(prev => (prev === current ? prev : current));
    };

    scheduleNextMidnight();
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      if (timeoutId !== undefined) window.clearTimeout(timeoutId);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, []);

  return today;
}

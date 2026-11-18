'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * True once `pending` has stayed true continuously for `ms` (default 30s).
 * Resets to false as soon as `pending` goes false. Use it to stop showing a
 * loading state for work that never finishes — the UI can then say plainly
 * that the data is not available instead of spinning forever.
 */
export function usePendingStuck(pending: boolean | undefined, ms = 30_000): boolean {
  const [stuck, setStuck] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (pending) {
      if (timer.current === null) {
        timer.current = setTimeout(() => setStuck(true), ms);
      }
    } else {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
      setStuck(false);
    }
    return () => {
      if (timer.current !== null) {
        clearTimeout(timer.current);
        timer.current = null;
      }
    };
  }, [pending, ms]);

  return stuck;
}

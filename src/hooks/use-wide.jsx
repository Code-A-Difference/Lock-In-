import { useEffect, useState } from 'react';

/** True from `min` px wide (1024 by default, where the sidebar appears and pages go side by side). */
export function useWide(min = 1024) {
  const q = `(min-width: ${min}px)`;
  const [wide, setWide] = useState(() => typeof window !== 'undefined' && window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const on = () => setWide(m.matches);
    on();
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [q]);
  return wide;
}

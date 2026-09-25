import { useCallback, useEffect, useRef, useState } from 'react';

/** Copy text to the clipboard with a short "copied" state. */
export function useCopy(timeout = 1400) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  const copy = useCallback(
    async (text: string) => {
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try {
          document.execCommand('copy');
        } finally {
          ta.remove();
        }
      }
      setCopied(true);
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), timeout);
    },
    [timeout],
  );
  return { copied, copy };
}

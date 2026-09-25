import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';

type Toast = { id: number; text: string; kind: 'info' | 'error' };
const Ctx = createContext<(text: string, kind?: 'info' | 'error') => void>(() => {});

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null);
  const timer = useRef<number | null>(null);
  const show = useCallback((text: string, kind: 'info' | 'error' = 'info') => {
    setToast({ id: Date.now(), text, kind });
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setToast(null), kind === 'error' ? 4000 : 2000);
  }, []);
  useEffect(() => () => {
    if (timer.current) window.clearTimeout(timer.current);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast ${toast.kind}`} role="status" aria-live="polite">
          {toast.text}
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useToast() {
  return useContext(Ctx);
}

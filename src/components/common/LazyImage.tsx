// Image attached to a message or returned by a tool. Fetched (with the bridge token) only
// when scrolled into view, rendered from a blob URL, and openable full-size in a lightbox.
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { api } from '@/services/api';

export function LazyImage({ url, alt = 'Image', caption }: { url: string; alt?: string; caption?: string }) {
  const ref = useRef<HTMLButtonElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [err, setErr] = useState(false);
  const [open, setOpen] = useState(false);
  const [dims, setDims] = useState<{ w: number; h: number } | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    let started = false;
    let blob: string | null = null;
    const start = () => {
      if (started || cancelled) return;
      started = true;
      io.disconnect();
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      api
        .fetchImage(url)
        .then((u) => {
          if (cancelled) URL.revokeObjectURL(u);
          else {
            blob = u;
            setSrc(u);
          }
        })
        .catch(() => !cancelled && setErr(true));
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) start();
    }, { rootMargin: '300px' });
    io.observe(el);
    // IntersectionObserver callbacks are paused in background tabs, so also check the
    // geometry directly: once on mount and (throttled) on any scroll.
    const near = () => {
      const r = el.getBoundingClientRect();
      return r.bottom > -300 && r.top < window.innerHeight + 300;
    };
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (timer || started) return;
      timer = setTimeout(() => {
        timer = null;
        if (near()) start();
      }, 120);
    };
    window.addEventListener('scroll', onScroll, { capture: true, passive: true });
    if (near()) start();
    return () => {
      cancelled = true;
      io.disconnect();
      window.removeEventListener('scroll', onScroll, { capture: true } as EventListenerOptions);
      if (timer) clearTimeout(timer);
      if (blob) URL.revokeObjectURL(blob);
    };
  }, [url]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  return (
    <>
      <button ref={ref} type="button" className="img-thumb" onClick={() => src && setOpen(true)} title={src ? `Open full size${dims ? ` (${dims.w}×${dims.h})` : ''}` : undefined} disabled={!src}>
        {src ? <img src={src} alt={alt} onLoad={(e) => setDims({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })} /> : <div className="img-ph">{err ? 'image unavailable' : 'loading image…'}</div>}
        {caption && <span className="img-cap">{caption}{dims ? ` · ${dims.w}×${dims.h}` : ''}</span>}
      </button>
      {open && src && createPortal(
        <div className="lightbox" onClick={() => setOpen(false)} role="dialog" aria-label="Image preview">
          <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} />
          <div className="lightbox-bar">{caption || alt}{dims ? ` · ${dims.w}×${dims.h}` : ''} · click outside or press Esc to close</div>
        </div>,
        document.body,
      )}
    </>
  );
}

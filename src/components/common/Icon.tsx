// Inline SVG icons (stroke-based, 16px grid). No icon font, no network.
const PATHS: Record<string, string> = {
  search: 'M11 11l3.5 3.5M7 12.5a5.5 5.5 0 1 0 0-11 5.5 5.5 0 0 0 0 11z',
  refresh: 'M13.5 8a5.5 5.5 0 1 1-1.6-3.9M13.5 2v3h-3',
  settings: 'M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5zM13 8l1.3-.6-.6-2.2-1.4.2-.9-.9.2-1.4-2.2-.6L8.8 4H7.2l-.6-1.3-2.2.6.2 1.4-.9.9-1.4-.2-.6 2.2L3 8l-1.3.6.6 2.2 1.4-.2.9.9-.2 1.4 2.2.6.6-1.3h1.6l.6 1.3 2.2-.6-.2-1.4.9-.9 1.4.2.6-2.2z',
  chevron: 'M6 3.5L10.5 8 6 12.5',
  chevronDown: 'M3.5 6L8 10.5 12.5 6',
  x: 'M4 4l8 8M12 4l-8 8',
  check: 'M3 8.5l3 3 7-7',
  copy: 'M6 6h7v7H6zM3 10V3h7',
  edit: 'M3 13h3l7-7-3-3-7 7zM9 4l3 3',
  more: 'M8 4.2h.01M8 8h.01M8 11.8h.01',
  code: 'M5.5 4L2 8l3.5 4M10.5 4L14 8l-3.5 4',
  info: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 7v4M8 5v.01',
  warn: 'M8 2l6.5 11.5h-13zM8 7v3M8 12v.01',
  folder: 'M2 4h4l1.5 1.5H14v8H2z',
  external: 'M9 3h4v4M13 3L7 9M11 9v4H3V5h4',
  arrowUp: 'M8 13V3M3.5 7.5L8 3l4.5 4.5',
  arrowDown: 'M8 3v10M3.5 8.5L8 13l4.5-4.5',
  expand: 'M3 6V3h3M13 6V3h-3M3 10v3h3M13 10v3h-3',
  collapse: 'M6 3v3H3M10 3v3h3M6 13v-3H3M10 13v-3h3',
  list: 'M3 4h10M3 8h10M3 12h10',
  clock: 'M8 14.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13zM8 4.5V8l2.5 1.5',
  wrap: 'M2 4h12M2 8h9a2 2 0 0 1 0 4H9M9 10l-1.5 2L9 14M2 12h4',
  image: 'M2.5 3h11v10h-11zM5 9l2-2 3 3 2-2 1.5 1.5M5.5 6h.01',
  filter: 'M2 3h12L9.5 8.5V13l-3-1.5v-3z',
  reset: 'M2.5 8a5.5 5.5 0 1 0 1.6-3.9M2.5 2v3h3',
  sidebar: 'M2 3h12v10H2zM6 3v10',
  bolt: 'M9 2L3 9h4l-1 5 6-7H8z',
  agent: 'M8 2a3 3 0 1 1 0 6 3 3 0 0 1 0-6zM2.5 14a5.5 5.5 0 0 1 11 0M11 5h3M12.5 3.5v3',
};

export function Icon({ name, size = 14, className = '' }: { name: keyof typeof PATHS | string; size?: number; className?: string }) {
  const d = PATHS[name] || PATHS.info;
  return (
    <svg className={`icon-svg ${className}`} width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

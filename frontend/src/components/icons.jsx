// Minimal stroke icons (Lucide-style) + the DocAnchor brand mark.
// All inherit color via `currentColor` and size via className.

function Svg({ children, className = "h-4 w-4", strokeWidth = 2, ...rest }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export function IconUpload(p) {
  return (
    <Svg {...p}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </Svg>
  );
}

export function IconKey(p) {
  return (
    <Svg {...p}>
      <circle cx="7.5" cy="15.5" r="5.5" />
      <path d="m21 2-9.6 9.6" />
      <path d="m15.5 7.5 3 3L22 7l-3-3" />
    </Svg>
  );
}

export function IconReset(p) {
  return (
    <Svg {...p}>
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </Svg>
  );
}

export function IconSun(p) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </Svg>
  );
}

export function IconMoon(p) {
  return (
    <Svg {...p}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </Svg>
  );
}

export function IconPanel(p) {
  return (
    <Svg {...p}>
      <rect width="18" height="18" x="3" y="3" rx="2" />
      <path d="M15 3v18" />
    </Svg>
  );
}

export function IconSend(p) {
  return (
    <Svg {...p}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </Svg>
  );
}

export function IconCheck(p) {
  return (
    <Svg {...p}>
      <polyline points="20 6 9 17 4 12" />
    </Svg>
  );
}

export function IconX(p) {
  return (
    <Svg {...p}>
      <path d="M18 6 6 18M6 6l12 12" />
    </Svg>
  );
}

export function IconSpinner({ className = "h-4 w-4" }) {
  return <Svg className={`${className} animate-spin`}><path d="M21 12a9 9 0 1 1-6.219-8.56" /></Svg>;
}

export function IconCopy(p) {
  return (
    <Svg {...p}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </Svg>
  );
}

export function IconRefresh(p) {
  return (
    <Svg {...p}>
      <path d="M21 12a9 9 0 1 1-3-6.7L21 8" />
      <path d="M21 3v5h-5" />
    </Svg>
  );
}

export function IconMic(p) {
  return (
    <Svg {...p}>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="17" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </Svg>
  );
}

export function IconTrash(p) {
  return (
    <Svg {...p}>
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </Svg>
  );
}

export function IconLink(p) {
  return (
    <Svg {...p}>
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

export function IconFile(p) {
  return (
    <Svg {...p}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </Svg>
  );
}

// Anchor glyph (the "anchor" in DocAnchor).
export function IconAnchor(p) {
  return (
    <Svg {...p}>
      <circle cx="12" cy="5" r="3" />
      <line x1="12" y1="22" x2="12" y2="8" />
      <path d="M5 12H2a10 10 0 0 0 20 0h-3" />
    </Svg>
  );
}

// Brand mark: anchor on the accent gradient in a rounded square.
export function BrandMark({ className = "h-6 w-6", rounded = "rounded-md" }) {
  return (
    <span
      className={`inline-flex items-center justify-center bg-gradient-to-br from-indigo-400 to-accent text-white ${rounded} ${className}`}
    >
      <IconAnchor className="h-[58%] w-[58%]" strokeWidth={2.3} />
    </span>
  );
}

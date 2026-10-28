/**
 * The one utility icon set (everything except the five nav items, which keep their GenIcon art): 16px viewBox,
 * outline, 1.5px stroke with round caps and joins, painted in currentColor so a glyph always takes its control's
 * text colour. Decorative by default (aria-hidden): the control around it carries the accessible name.
 */
import type { CSSProperties, ReactNode } from "react";

export type IconName =
  | "close"
  | "chevron-left"
  | "chevron-right"
  | "chevron-down"
  | "search"
  | "menu"
  | "help"
  | "share"
  | "external"
  | "check"
  | "plus"
  | "minus"
  | "rotate-3d"
  | "turn-over"
  | "pause"
  | "play"
  | "copy"
  | "warning"
  | "triangle-up"
  | "triangle-down"
  | "motion";

const PATHS: Record<IconName, ReactNode> = {
  close: <path d="M4 4l8 8M12 4l-8 8" />,
  "chevron-left": <path d="M10 3.5 5.5 8l4.5 4.5" />,
  "chevron-right": <path d="M6 3.5 10.5 8 6 12.5" />,
  "chevron-down": <path d="M3.5 6 8 10.5 12.5 6" />,
  search: (
    <>
      <circle cx="7" cy="7" r="4.25" />
      <path d="m10.25 10.25 3.25 3.25" />
    </>
  ),
  menu: <path d="M2.75 4.5h10.5M2.75 8h10.5M2.75 11.5h10.5" />,
  help: (
    <>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M6.3 6.3a1.75 1.75 0 1 1 2.46 1.6c-.45.2-.76.6-.76 1.1v.25" />
      <path d="M8 11.4v.1" />
    </>
  ),
  share: (
    <>
      <path d="M8 2.5v7.5M5 5.25 8 2.5l3 2.75" />
      <path d="M4.5 7.5h-1v6h9v-6h-1" />
    </>
  ),
  external: (
    <>
      <path d="M9.5 2.75h3.75V6.5M13.25 2.75 7.5 8.5" />
      <path d="M11.5 9.5v3.75h-8.75V4.5H6.5" />
    </>
  ),
  check: <path d="M3.25 8.25 6.5 11.5l6.25-7" />,
  plus: <path d="M8 3v10M3 8h10" />,
  minus: <path d="M3 8h10" />,
  "rotate-3d": (
    <>
      <ellipse cx="8" cy="8" rx="6.25" ry="2.75" />
      <path d="M8 1.75v12.5" />
      <path d="M11.5 4.5 12.9 6l-1.9.75" />
    </>
  ),
  "turn-over": (
    <>
      <path d="M3 6.25a5 5 0 0 1 9.4-1.5M13 9.75a5 5 0 0 1-9.4 1.5" />
      <path d="M12.75 2.5v2.5h-2.5M3.25 13.5V11h2.5" />
    </>
  ),
  pause: <path d="M5.75 3.5v9M10.25 3.5v9" />,
  play: <path d="M5 3.25v9.5L12.25 8 5 3.25Z" />,
  copy: (
    <>
      <rect x="5.5" y="5.5" width="7.75" height="7.75" rx="1.75" />
      <path d="M10.5 3.25V2.75h-7.75v7.75h.5" />
    </>
  ),
  warning: (
    <>
      <path d="M8 2.25 14.25 13.5H1.75L8 2.25Z" />
      <path d="M8 6.5v3M8 11.6v.1" />
    </>
  ),
  "triangle-up": <path d="M8 4.5 12 11H4l4-6.5Z" />,
  "triangle-down": <path d="M8 11.5 4 5h8l-4 6.5Z" />,
  // Calm motion: a slowed wave.
  motion: <path d="M1.75 9c1.6 0 1.6-3 3.15-3s1.55 4 3.1 4 1.55-4 3.1-4 1.55 3 3.15 3" />,
};

/** Filled glyphs (the triangles and play) read better solid at 16px. */
const FILLED = new Set<IconName>(["triangle-up", "triangle-down", "play"]);

export function Icon({
  name,
  size = 16,
  strokeWidth = 1.5,
  className = "",
  style,
  label,
}: {
  name: IconName;
  size?: number;
  /** 1.5 beside 400-weight text; 2 beside 600-weight labels (MIFB). */
  strokeWidth?: number;
  className?: string;
  style?: CSSProperties;
  /** A glyph that is the only content and carries meaning (rare): its accessible name. */
  label?: string;
}) {
  const filled = FILLED.has(name);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ? `mdx-glyph ${className}` : "mdx-glyph"}
      style={style}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
    >
      {PATHS[name]}
    </svg>
  );
}

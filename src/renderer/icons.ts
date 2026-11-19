// Shared SVG icons used by both the sidebar project actions and the tab bar, so
// the same concept (Sessions / Files) renders
// identically in both places. Single source of truth — edit here, not in
// sidebar.ts.
//
// Thin stroke-based (Lucide) outlines on a 24×24 grid — the glyphs from the
// "Studio" design system's active-project menu. The browser icon stays
// CSS-drawn (.toolbar-icon-browser in tabs.css).

const STROKE_ICON = (body: string): string =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

// Project menu — exact glyphs from the Studio design system.

export const ICON_SESSIONS = STROKE_ICON('<circle cx="12" cy="12" r="8"/><path d="M12 8v4l2.5 1.5"/>');

export const ICON_FILES = STROKE_ICON('<path d="M4 6a1.5 1.5 0 0 1 1.5-1.5H9l2 2h6.5A1.5 1.5 0 0 1 19 8v9.5a1.5 1.5 0 0 1-1.5 1.5h-12A1.5 1.5 0 0 1 4 17.5z"/>');

export const ICON_GIT = STROKE_ICON('<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="17" cy="9" r="2.5"/><path d="M6 8.5v7M17 11.5a5 5 0 0 1-5 5H8.5"/>');

export const ICON_TERMINAL = STROKE_ICON('<path d="m4 17 6-6-6-6"/><path d="M12 19h8"/>');

export const ICON_MENU = STROKE_ICON('<line x1="4" x2="20" y1="12" y2="12"/><line x1="4" x2="20" y1="6" y2="6"/><line x1="4" x2="20" y1="18" y2="18"/>');

export const ICON_PROJECTS = STROKE_ICON('<path d="M3.5 6.5a1.5 1.5 0 0 1 1.5-1.5h4l1.8 2H19a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 19 19H5a1.5 1.5 0 0 1-1.5-1.5z"/><path d="M3.5 10.5h17"/>');

export const ICON_SETTINGS = STROKE_ICON('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>');

// ── Provider marks ──────────────────────────────────────────────────────────
// The four bundled CLIs ship a brand PNG in assets/providers/<id>.png, which
// the tab bar renders as an <img>. Providers added later have no logo file, so
// they get a stroke glyph here instead — same 14px box, theme-aware colour.

export const PROVIDER_ICONS: Record<string, string> = {
  // π — pi's own mark.
  pi: STROKE_ICON('<path d="M5 7.5h14"/><path d="M9.5 7.5V18"/><path d="M15.5 7.5V16c0 1 .7 2 2 2"/>'),
  // >_ inside a rounded terminal — opencode is a terminal agent.
  opencode: STROKE_ICON('<rect x="3" y="4.5" width="18" height="15" rx="2"/><path d="m7.5 10 2.5 2-2.5 2"/><path d="M13 14h4"/>'),
  // Sliders — a CLI the user configured themselves.
  custom: STROKE_ICON('<path d="M4 7h10M18 7h2M4 12h4M12 12h8M4 17h10M18 17h2"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="16" cy="17" r="2"/>'),
};

/** Inline mark for providers without a bundled PNG, or null when a PNG exists. */
export function providerGlyph(providerId: string): string | null {
  return PROVIDER_ICONS[providerId] ?? null;
}

/**
 * One provider's mark, as HTML. The four bundled CLIs ship a brand PNG; the ones
 * added later use the stroke glyph above. `variant` only picks the wrapper class
 * so the tab bar (14px inline) and the New Session button can size it.
 */
export function providerMark(providerId: string, variant: 'tab' | 'button'): string {
  const glyph = providerGlyph(providerId);
  if (glyph) {
    return `<span class="${variant}-provider-glyph" aria-hidden="true">${glyph}</span>`;
  }
  return `<img class="${variant}-provider-icon" src="assets/providers/${providerId}.png" alt="" onerror="this.style.display='none'">`;
}

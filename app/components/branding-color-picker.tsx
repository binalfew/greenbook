import { useState } from "react";
import { BRAND_THEMES } from "~/utils/schemas/organization";

/**
 * Preview swatches used in the picker. Colors are indicative — the actual
 * theme comes from the `[data-brand="..."]` block in `app/app.css`. Add an
 * entry here when you add a theme, otherwise the swatch falls back to a
 * neutral grey placeholder.
 */
const BRAND_THEME_PREVIEWS: Record<
  string,
  { bg: string; fg: string; primary: string; accent: string }
> = {
  nature: { bg: "#f0ebe0", fg: "#553828", primary: "#3b8a4c", accent: "#c5d9b2" },
  quantum: { bg: "#f5e2ea", fg: "#8c2858", primary: "#d04868", accent: "#e0b0bc" },
  haze: { bg: "#f3f0f6", fg: "#544870", primary: "#8b78a8", accent: "#c89ca0" },
  graphite: { bg: "#e8e8e8", fg: "#4a4a4a", primary: "#6f6f6f", accent: "#c0c0c0" },
  tangerine: { bg: "#e5e8ec", fg: "#4a4a4a", primary: "#c87338", accent: "#dde0ea" },
  matter: { bg: "#ffffff", fg: "#1a2340", primary: "#c08040", accent: "#4a8a8a" },
  vercel: { bg: "#fcfcfc", fg: "#000000", primary: "#000000", accent: "#e0e0e0" },
  claude: { bg: "#f5f0e8", fg: "#504830", primary: "#c07a3a", accent: "#e0dcd0" },
  catppuccin: { bg: "#e8e8f0", fg: "#5c5880", primary: "#8839ef", accent: "#209fb5" },
  slate: { bg: "#f8f8fc", fg: "#334155", primary: "#4f46e5", accent: "#e0e4f0" },
  cosmic: { bg: "#f0ecf8", fg: "#3b2d6b", primary: "#6d28d9", accent: "#e0e4f8" },
  elegant: { bg: "#f8f2e8", fg: "#2d2d2d", primary: "#8b3a2a", accent: "#e8e0c0" },
  mono: { bg: "#ffffff", fg: "#1a1a1a", primary: "#808080", accent: "#f0f0f0" },
};

export function BrandingColorSection({ initialBrandTheme }: { initialBrandTheme?: string }) {
  const [brandTheme, setBrandTheme] = useState(initialBrandTheme ?? "");
  const themes = BRAND_THEMES.filter((t) => t.value !== "");

  return (
    <div className="space-y-3">
      <div>
        <h3 className="text-sm font-semibold">Theme</h3>
        <p className="text-muted-foreground text-xs">
          Select a complete theme that customizes all colors (background, cards, sidebar, borders,
          etc.) in both light and dark modes.
        </p>
      </div>

      <input type="hidden" name="brandTheme" value={brandTheme} />

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
        <button
          type="button"
          onClick={() => setBrandTheme("")}
          className={`group flex flex-col items-center gap-2 rounded-lg border p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md ${
            brandTheme === ""
              ? "ring-primary border-primary shadow-sm ring-2 ring-offset-2"
              : "border-border hover:border-primary/50"
          }`}
        >
          <div className="flex h-5 items-center justify-center">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-muted-foreground"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
            </svg>
          </div>
          <span className="text-muted-foreground group-hover:text-foreground w-full truncate text-center text-[10px] leading-tight">
            Default
          </span>
        </button>

        {themes.map((theme) => {
          const isActive = brandTheme === theme.value;
          const preview = BRAND_THEME_PREVIEWS[theme.value];
          return (
            <button
              key={theme.value}
              type="button"
              onClick={() => setBrandTheme(theme.value)}
              className={`group flex flex-col items-center gap-2 rounded-lg border p-2.5 transition-all hover:-translate-y-0.5 hover:shadow-md ${
                isActive
                  ? "ring-primary border-primary shadow-sm ring-2 ring-offset-2"
                  : "border-border hover:border-primary/50"
              }`}
            >
              {preview ? (
                <div
                  className="flex h-5 w-full items-center justify-center gap-1 rounded-sm px-1"
                  style={{ backgroundColor: preview.bg }}
                >
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
                    style={{ backgroundColor: preview.primary }}
                  />
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
                    style={{ backgroundColor: preview.accent }}
                  />
                  <span
                    className="h-3.5 w-3.5 rounded-full border border-black/10 shadow-sm"
                    style={{ backgroundColor: preview.fg }}
                  />
                </div>
              ) : (
                <div className="bg-muted h-5 w-full rounded-sm" />
              )}
              <span className="text-muted-foreground group-hover:text-foreground w-full truncate text-center text-[10px] leading-tight">
                {theme.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { z } from "zod/v4";

/**
 * Available brand themes — each maps to a `[data-brand="..."]` block in
 * `app/app.css` with light + dark variable overrides. To add a theme, append
 * its swatch block to the CSS and add an entry here.
 */
export const BRAND_THEMES = [
  { value: "", label: "None (default)" },
  { value: "nature", label: "Nature" },
  { value: "quantum", label: "Quantum" },
  { value: "haze", label: "Haze" },
  { value: "graphite", label: "Graphite" },
  { value: "tangerine", label: "Tangerine" },
  { value: "matter", label: "Matter" },
  { value: "vercel", label: "Vercel" },
  { value: "claude", label: "Claude" },
  { value: "catppuccin", label: "Catppuccin" },
  { value: "slate", label: "Slate" },
  { value: "cosmic", label: "Cosmic" },
  { value: "elegant", label: "Elegant" },
  { value: "mono", label: "Mono" },
  { value: "auc", label: "AUC" },
] as const;

export const organizationSchema = z.object({
  name: z.string({ error: "Name is required" }).min(1, "Name is required").max(200),
  email: z.email("Valid email is required"),
  phone: z.string({ error: "Phone is required" }).min(1, "Phone is required"),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  logoUrl: z.string().optional(),
  brandTheme: z.string().optional(),
});

export const LAYOUT_MODES = ["sidebar", "navbar"] as const;
export type LayoutMode = (typeof LAYOUT_MODES)[number];

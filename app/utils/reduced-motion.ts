import { type ClientHint } from "./types";

/**
 * @public
 */
export const reducedMotionClientHint = {
  cookieName: "CH-reduced-motion",
  getValueCode: `window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduce' : 'no-preference'`,
  fallback: "no-preference",
  transform(value: string | null) {
    return value === "reduce" ? "reduce" : "no-preference";
  },
} as const satisfies ClientHint<"reduce" | "no-preference">;

/**
 * Subscribe to changes in the user's motion preference. Optionally pass
 * in a cookie name to use for the cookie that will be set if different from the
 * default.
 * @public
 */
export function subscribeToMotionChange(
  subscriber: (value: "reduce" | "no-preference") => void,
  cookieName: string = reducedMotionClientHint.cookieName,
) {
  const motionMatch = window.matchMedia("(prefers-reduced-motion: reduce)");
  function handleMotionChange() {
    const value = motionMatch.matches ? "reduce" : "no-preference";
    document.cookie = `${cookieName}=${value}; Max-Age=31536000; Path=/`;
    subscriber(value);
  }
  motionMatch.addEventListener("change", handleMotionChange);
  return function cleanupMotionChange() {
    motionMatch.removeEventListener("change", handleMotionChange);
  };
}

import { useEffect, useRef, useCallback } from "react";

// ─── Types ───────────────────────────────────────────────

export interface ShortcutDefinition {
  /** Unique key for this shortcut */
  id: string;
  /** Display label for the key combination (e.g., "⌘K", "g then e") */
  keys: string;
  /** Human-readable description */
  description: string;
  /** Category for grouping in help dialog */
  group: "global" | "navigation" | "workflow" | "designer";
  /** The handler to invoke */
  handler: () => void;
  /** Whether the shortcut requires Ctrl/Cmd modifier */
  mod?: boolean;
  /** Whether the shortcut requires Shift modifier */
  shift?: boolean;
  /** Whether the shortcut requires Alt modifier */
  alt?: boolean;
  /** The key(s) to detect. Single string for simple, [first, second] for chord. */
  key: string | [string, string];
  /** Whether this shortcut is currently enabled */
  enabled?: boolean;
}

export interface ShortcutInfo {
  id: string;
  keys: string;
  description: string;
  group: "global" | "navigation" | "workflow" | "designer";
}

interface UseKeyboardShortcutsOptions {
  /** Master enable/disable switch */
  enabled?: boolean;
}

// ─── Constants ───────────────────────────────────────────

const CHORD_TIMEOUT_MS = 800;

// ─── Helpers ─────────────────────────────────────────────

function isInputFocused(): boolean {
  const el = document.activeElement;
  if (!el) return false;

  const tagName = el.tagName.toLowerCase();
  if (tagName === "input" || tagName === "textarea" || tagName === "select") return true;
  if ((el as HTMLElement).isContentEditable) return true;

  return false;
}

/**
 * Extract shortcut info (without handlers) for display in help dialog.
 */
export function getShortcutInfo(shortcuts: ShortcutDefinition[]): ShortcutInfo[] {
  return shortcuts.map(({ id, keys, description, group }) => ({
    id,
    keys,
    description,
    group,
  }));
}

// ─── Hook ────────────────────────────────────────────────

/**
 * React hook for registering keyboard shortcuts with chord support.
 *
 * Features:
 * - Modifier key support (Ctrl/Cmd, Shift, Alt)
 * - Chord support (e.g., "g" then "e" for Go to Events)
 * - Automatically disabled when focus is in text inputs
 * - Cross-platform: uses metaKey on Mac, ctrlKey on Windows/Linux
 */
export function useKeyboardShortcuts(
  shortcuts: ShortcutDefinition[],
  options: UseKeyboardShortcutsOptions = {},
) {
  const { enabled = true } = options;
  const chordKeyRef = useRef<string | null>(null);
  const chordTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shortcutsRef = useRef(shortcuts);
  shortcutsRef.current = shortcuts;

  const clearChord = useCallback(() => {
    chordKeyRef.current = null;
    if (chordTimeoutRef.current) {
      clearTimeout(chordTimeoutRef.current);
      chordTimeoutRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;

    function handleKeyDown(e: KeyboardEvent) {
      if (!e.key) return;
      const hasMod = e.metaKey || e.ctrlKey;

      // Find matching shortcut
      for (const shortcut of shortcutsRef.current) {
        if (shortcut.enabled === false) continue;

        // Check modifier requirements
        const needsMod = shortcut.mod === true;
        const needsShift = shortcut.shift === true;
        const needsAlt = shortcut.alt === true;

        if (needsMod && !hasMod) continue;
        if (!needsMod && hasMod) continue;
        if (needsShift && !e.shiftKey) continue;
        if (needsAlt && !e.altKey) continue;

        // For simple alpha keys (a-z), reject if shift is pressed but not required.
        // Non-alpha keys like "?" inherently need shift to produce the character,
        // so we must not reject them based on shift state.
        const shortcutKey = Array.isArray(shortcut.key) ? shortcut.key[0] : shortcut.key;
        const isAlpha = /^[a-z]$/i.test(shortcutKey);
        if (!needsShift && e.shiftKey && isAlpha && !hasMod) continue;

        // Chord shortcut (e.g., ["g", "e"])
        if (Array.isArray(shortcut.key)) {
          const [first, second] = shortcut.key;

          if (chordKeyRef.current === first && e.key.toLowerCase() === second) {
            // Skip input check only for the first key; second key completes the chord
            if (isInputFocused()) continue;
            e.preventDefault();
            clearChord();
            shortcut.handler();
            return;
          }

          // Check if this is the first key of a chord
          if (e.key.toLowerCase() === first && !chordKeyRef.current) {
            if (isInputFocused()) continue;
            if (hasMod || e.shiftKey || e.altKey) continue;
            chordKeyRef.current = first;
            chordTimeoutRef.current = setTimeout(clearChord, CHORD_TIMEOUT_MS);
            return;
          }

          continue;
        }

        // Simple shortcut
        if (e.key && e.key.toLowerCase() === shortcut.key.toLowerCase()) {
          // Allow modifier shortcuts even in inputs (e.g., ⌘K)
          if (!needsMod && isInputFocused()) continue;

          e.preventDefault();
          clearChord();
          shortcut.handler();
          return;
        }
      }

      // If we got here with a pending chord and it didn't match, clear it
      if (chordKeyRef.current && !e.metaKey && !e.ctrlKey) {
        clearChord();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      clearChord();
    };
  }, [enabled, clearChord]);
}

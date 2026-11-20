import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Is the on-screen keyboard open for the assistant's question field.
 *
 * With the keyboard open (390 × 480) the conversation was not visible at all:
 * the tab bar, the question field and the keyboard shared the whole screen
 * (Mini App audit 2026-11, П2). While the field has focus on a touch screen
 * the tab bar steps aside and the field drops to the bottom edge.
 *
 * Focus is the main signal, not the viewport height: Telegram reports its own
 * viewport changes, and a height threshold alone would mistake a landscape
 * turn for a keyboard. With a mouse there is no on-screen keyboard — nothing
 * changes.
 *
 * Focus alone is not enough, though: on Android the system Back key and
 * Telegram's `hideKeyboard()` (Bot API 9.1) close the keyboard and leave the
 * field focused. No blur comes, and the tab bar stayed hidden with no keyboard
 * on screen — the parent saw the menu vanish. So while the field has focus the
 * viewport is watched as well: it shrank when the keyboard came up, and when it
 * grows back the keyboard is gone. The field then loses focus, so that focus
 * and the keyboard agree again and the next tap on the field opens it anew.
 * Where the keyboard does not shrink the viewport, nothing is watched for —
 * focus stays the only signal.
 */
export interface KeyboardState {
  /** The question field is focused on a touch screen. */
  open: boolean;
  /** The question field gained (`true`) or lost (`false`) focus. */
  report: (focused: boolean) => void;
}

export const KeyboardContext = createContext<KeyboardState>({
  open: false,
  report: () => undefined,
});

/**
 * How much the viewport must shrink to count as a keyboard, px. The smallest
 * phone keyboards are about 200 px; Telegram's own bars change by less.
 */
export const KEYBOARD_MIN_PX = 120;

function touchScreen(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(pointer: coarse)").matches
  );
}

/**
 * Visible height: `visualViewport` shrinks under the keyboard on both iOS
 * (overlay) and Android (resize); `innerHeight` — where it is missing.
 */
function viewportHeight(): number {
  return window.visualViewport?.height ?? window.innerHeight;
}

/** The state that `Screens` owns and hands down through `KeyboardContext`. */
export function useKeyboardState(): KeyboardState {
  const [open, setOpen] = useState(false);
  // Height before the keyboard came up, and whether it has come up since.
  const base = useRef(0);
  const shrunk = useRef(false);

  const report = useCallback((focused: boolean) => {
    const next = focused && touchScreen();
    if (next) {
      base.current = viewportHeight();
      shrunk.current = false;
    }
    setOpen(next);
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    function onResize() {
      const height = viewportHeight();
      if (height < base.current - KEYBOARD_MIN_PX) {
        shrunk.current = true;
        return;
      }
      if (!shrunk.current) return;
      // The keyboard went away with the field still focused.
      shrunk.current = false;
      const active = document.activeElement;
      if (active instanceof HTMLElement) active.blur();
      setOpen(false);
    }
    const visual = window.visualViewport;
    visual?.addEventListener("resize", onResize);
    window.addEventListener("resize", onResize);
    return () => {
      visual?.removeEventListener("resize", onResize);
      window.removeEventListener("resize", onResize);
    };
  }, [open]);

  return useMemo(() => ({ open, report }), [open, report]);
}

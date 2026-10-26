import { useSyncExternalStore } from "react";

// Which floating sheets are open, for other floating things to keep out of their way (the call window and the chat
// sheet both live at the screen's edge). A tiny shared store, so neither component has to know about the other.

let chatOpen = false;
const listeners = new Set<() => void>();

export function setChatOpen(open: boolean) {
  if (open === chatOpen) return;
  chatOpen = open;
  for (const l of listeners) l();
}

const subscribe = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useChatOpen = () => useSyncExternalStore(subscribe, () => chatOpen, () => false);

/** Laptop layout (Tailwind's lg breakpoint), where the chat is a side panel rather than a bottom sheet. */
const wide = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
export function useWide() {
  return useSyncExternalStore(
    (l) => {
      const q = window.matchMedia("(min-width: 1024px)");
      q.addEventListener("change", l);
      return () => q.removeEventListener("change", l);
    },
    wide,
    () => true,
  );
}

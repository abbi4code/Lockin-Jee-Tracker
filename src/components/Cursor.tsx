"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Dot-matrix cursor for mouse and trackpad (touch screens keep the system one).
 * A dot follows the pointer exactly; a dotted ring trails it and changes shape with what's underneath:
 *   pointer  — buttons and links: dotted ring
 *   go       — primary actions (start a session): ring + red dot
 *   danger   — destructive actions (sign out, remove): everything red
 *   check    — checkboxes: dotted square
 *   text     — text fields: caret bar
 *   disabled — dim ring with a slash
 * Override the detected kind with data-cursor="go" | "danger" | … on any element. Styles live in globals.css.
 */

type Kind = "default" | "pointer" | "go" | "danger" | "check" | "text" | "disabled";

const TARGETS = 'a[href],button,[role="button"],[role="checkbox"],select,summary,input,textarea,[contenteditable="true"],[data-cursor]';
const TEXT_INPUTS = new Set(["text", "email", "password", "search", "number", "tel", "url"]);

function hexToRgb(hex: string) {
  const n = parseInt(hex.trim().replace("#", ""), 16);
  return `rgb(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255})`;
}

/** What the pointer is over, and whether that spot is filled with the foreground colour (then the cursor inverts). */
function inspect(target: EventTarget | null): { kind: Kind; invert: boolean } {
  if (!(target instanceof Element)) return { kind: "default", invert: false };
  const el = target.closest(TARGETS);
  let kind: Kind = "default";
  if (el) {
    const explicit = el.getAttribute("data-cursor") as Kind | null;
    if (el.matches(":disabled,[aria-disabled='true']")) kind = "disabled";
    else if (explicit) kind = explicit;
    else if (el.matches("textarea,[contenteditable='true']") || (el instanceof HTMLInputElement && TEXT_INPUTS.has(el.type))) kind = "text";
    else if (el.matches('[role="checkbox"],input[type="checkbox"]')) kind = "check";
    else kind = "pointer";
  }
  // Solid white (night) or ink-brown (paper) buttons would swallow a same-coloured cursor.
  const fg = hexToRgb(getComputedStyle(document.documentElement).getPropertyValue("--color-fg"));
  let invert = false;
  for (let n: Element | null = target; n && n !== document.body; n = n.parentElement) {
    if (getComputedStyle(n).backgroundColor === fg) {
      invert = true;
      break;
    }
  }
  return { kind, invert };
}

export function Cursor() {
  const [enabled, setEnabled] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const mq = window.matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setEnabled(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!enabled || !root.current || !dot.current || !ring.current) return;
    const r = root.current;
    const d = dot.current;
    const g = ring.current;
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let x = 0;
    let y = 0;
    let rx = 0;
    let ry = 0;
    let raf = 0;
    let shown = false;

    // The ring eases toward the pointer; the loop stops once it has caught up.
    const follow = () => {
      rx += (x - rx) * (still ? 1 : 0.28);
      ry += (y - ry) * (still ? 1 : 0.28);
      g.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      raf = Math.abs(x - rx) + Math.abs(y - ry) > 0.1 ? requestAnimationFrame(follow) : 0;
    };
    const move = (e: PointerEvent) => {
      if (e.pointerType === "touch") return hide();
      x = e.clientX;
      y = e.clientY;
      if (!shown) {
        // Appear where the pointer is instead of sweeping in from the corner.
        rx = x;
        ry = y;
        shown = true;
        r.dataset.hidden = "false";
      }
      d.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      if (!raf) raf = requestAnimationFrame(follow);
    };
    const over = (e: PointerEvent) => {
      const { kind, invert } = inspect(e.target);
      r.dataset.kind = kind;
      r.dataset.invert = String(invert);
    };
    const hide = () => {
      shown = false;
      r.dataset.hidden = "true";
    };
    const down = () => (r.dataset.down = "true");
    const up = () => (r.dataset.down = "false");

    document.documentElement.classList.add("has-cursor");
    document.addEventListener("pointermove", move, { passive: true });
    document.addEventListener("pointerover", over, { passive: true });
    document.addEventListener("pointerdown", down, { passive: true });
    document.addEventListener("pointerup", up, { passive: true });
    document.documentElement.addEventListener("mouseleave", hide);
    window.addEventListener("blur", hide);
    return () => {
      cancelAnimationFrame(raf);
      document.documentElement.classList.remove("has-cursor");
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerover", over);
      document.removeEventListener("pointerdown", down);
      document.removeEventListener("pointerup", up);
      document.documentElement.removeEventListener("mouseleave", hide);
      window.removeEventListener("blur", hide);
    };
  }, [enabled]);

  if (!enabled) return null;
  return (
    <div ref={root} aria-hidden data-cursor-root="" data-kind="default" data-hidden="true" data-invert="false" data-down="false">
      <div ref={ring} className="cursor-ring" />
      <div ref={dot} className="cursor-dot" />
    </div>
  );
}

"use client";

import { motion } from "motion/react";
import { THEMES, setTheme, useTheme } from "../lib/theme";
import { buzz } from "./Controls";

/** Three swatches: night, paper, sepia. The ring slides to the active one. */
export function ThemeSwitcher({ showLabels = false }: { showLabels?: boolean }) {
  const theme = useTheme();
  return (
    <div className="flex items-center gap-3">
      {THEMES.map((t) => (
        <button
          key={t.id}
          aria-label={`${t.label} theme`}
          onClick={() => {
            buzz();
            setTheme(t.id);
          }}
          className="flex items-center gap-2"
        >
          <span className="relative grid size-7 place-items-center">
            {theme === t.id && <motion.span layoutId={`theme-ring-${showLabels ? "full" : "mini"}`} className="absolute inset-0 rounded-full border-[1.5px] border-fg" transition={{ type: "spring", stiffness: 500, damping: 35 }} />}
            <span className="size-5 rounded-full border border-line-2" style={{ background: t.bg }}>
              <span className="m-auto mt-[7px] block size-1.5 rounded-full" style={{ background: t.fg }} />
            </span>
          </span>
          {showLabels && <span className={`font-mono text-[13px] ${theme === t.id ? "text-fg" : "text-mute"}`}>{t.label}</span>}
        </button>
      ))}
    </div>
  );
}

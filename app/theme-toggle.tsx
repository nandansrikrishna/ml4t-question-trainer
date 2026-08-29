"use client";
// Adapted from beui.dev/components/motion/theme-toggle.

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";

const STORAGE_KEY = "ml4t-recall-theme";

type Theme = "light" | "dark";
type ViewTransitionDocument = Document & {
  startViewTransition: (update: () => void) => { finished: Promise<void> };
};

function applyTheme(theme: Theme, persist = false) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;

  if (persist) {
    try {
      window.localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      // The theme still applies when storage is unavailable (for example, in a locked-down browser).
    }
  }
}

export default function ThemeToggle() {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const syncTheme = () => {
      let stored: string | null = null;
      try {
        stored = window.localStorage.getItem(STORAGE_KEY);
      } catch {
        // Fall back to the operating-system preference when storage is unavailable.
      }
      const theme: Theme = stored === "dark" || (stored === null && media.matches) ? "dark" : "light";
      applyTheme(theme);
      setIsDark(theme === "dark");
    };
    const syncStoredTheme = (event: StorageEvent) => {
      if (event.key === STORAGE_KEY) syncTheme();
    };

    syncTheme();
    media.addEventListener("change", syncTheme);
    window.addEventListener("storage", syncStoredTheme);

    return () => {
      media.removeEventListener("change", syncTheme);
      window.removeEventListener("storage", syncStoredTheme);
    };
  }, []);

  const toggleTheme = () => {
    const nextTheme: Theme = document.documentElement.classList.contains("dark") ? "light" : "dark";
    const update = () => {
      applyTheme(nextTheme, true);
      setIsDark(nextTheme === "dark");
    };

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !("startViewTransition" in document)) {
      update();
      return;
    }

    const root = document.documentElement;
    root.style.setProperty("--beui-vt-from", "inset(100% 0 0 0)");
    root.dataset.beuiVt = "rect";

    const transition = (document as ViewTransitionDocument).startViewTransition(update);
    transition.finished.finally(() => {
      delete root.dataset.beuiVt;
    });
  };

  return (
    <button
      type="button"
      className="theme-toggle"
      aria-label={isDark ? "Switch to light mode" : "Switch to dark mode"}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      onClick={toggleTheme}
    >
      <span className="theme-toggle-icons" aria-hidden="true">
        <span className="theme-icon theme-icon-moon"><Moon /></span>
        <span className="theme-icon theme-icon-sun"><Sun /></span>
      </span>
    </button>
  );
}

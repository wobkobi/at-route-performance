// src/app/fonts.ts
/**
 * @description Local Gotham Narrow font face exposing the --font-gotham-narrow CSS variable.
 */
import localFont from "next/font/local";

/**
 * Gotham Narrow (local) with sensible fallbacks.
 * Exposes CSS var: --font-gotham-narrow
 */
export const gothamNarrow = localFont({
  variable: "--font-gotham-narrow",
  display: "swap",
  adjustFontFallback: "Arial",
  fallback: ["Open Sans", "Arial", "ui-sans-serif", "system-ui", "sans-serif"],
  src: [
    {
      path: "../../public/source/fonts/gotham-narrow/gotham-narrow-light.otf",
      weight: "300",
      style: "normal",
    },
    {
      path: "../../public/source/fonts/gotham-narrow/gotham-narrow-book.otf",
      weight: "400",
      style: "normal",
    },
    {
      path: "../../public/source/fonts/gotham-narrow/gotham-narrow-medium.otf",
      weight: "500",
      style: "normal",
    },
    {
      path: "../../public/source/fonts/gotham-narrow/gotham-narrow-ultra.otf",
      weight: "900",
      style: "normal",
    },
  ],
});

"use client";

import { useEffect } from "react";

declare global {
  interface Window {
    UnicornStudio?: { init: () => void };
  }
}

// Module-level flag prevents duplicate <script> injection across React re-renders
let _unicornScriptLoaded = false;

export function AuraBackground() {
  useEffect(() => {
    if (_unicornScriptLoaded) {
      // Script already in the DOM from a previous mount — just re-init
      window.UnicornStudio?.init();
      return;
    }
    _unicornScriptLoaded = true;
    const script = document.createElement("script");
    script.src =
      "https://cdn.jsdelivr.net/gh/hiunicornstudio/unicornstudio.js@v1.4.29/dist/unicornStudio.umd.js";
    script.onload = () => window.UnicornStudio?.init();
    document.head.appendChild(script);
  }, []);

  return (
    <>
      {/* CSS fallback — black base + blue/purple radial glows + grid + dots.
          Always visible; acts as base while Unicorn loads (or if it fails). */}
      <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black">
        {/* Radial glows */}
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(circle at 50% 8%,  rgba(59,130,246,0.32), transparent 38%),
              radial-gradient(circle at 80% 65%, rgba(139,92,246,0.20), transparent 32%),
              radial-gradient(circle at 20% 80%, rgba(34,211,238,0.14),  transparent 35%)
            `,
          }}
        />
        {/* Blue grid fading to edges */}
        <div
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage: `
              linear-gradient(rgba(59,130,246,0.12) 1px, transparent 1px),
              linear-gradient(90deg, rgba(59,130,246,0.12) 1px, transparent 1px)
            `,
            backgroundSize: "48px 48px",
            maskImage:
              "radial-gradient(circle at center, black 0%, black 45%, transparent 80%)",
            WebkitMaskImage:
              "radial-gradient(circle at center, black 0%, black 45%, transparent 80%)",
          }}
        />
        {/* Subtle dot texture */}
        <div
          className="absolute inset-0 opacity-10"
          style={{
            backgroundImage:
              "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)",
            backgroundSize: "40px 40px",
          }}
        />
      </div>

      {/* Unicorn Studio embed — layers on top of CSS fallback */}
      <div
        className="fixed top-0 left-0 w-full h-screen z-[1] pointer-events-none overflow-hidden"
        style={{
          maskImage:
            "linear-gradient(to bottom, transparent, black 0%, black 80%, transparent)",
          WebkitMaskImage:
            "linear-gradient(to bottom, transparent, black 0%, black 80%, transparent)",
        }}
      >
        <div
          data-us-project="FixNvEwvWwbu3QX9qC3F"
          className="absolute left-0 top-0 h-full w-full"
        />
      </div>
    </>
  );
}

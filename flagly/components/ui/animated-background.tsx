"use client";

export function AnimatedBackground() {
  return (
    <div
      aria-hidden="true"
      className="absolute inset-0 z-0 overflow-hidden pointer-events-none select-none"
    >
      {/* Dot grid texture */}
      <div className="absolute inset-0 bg-dot-grid opacity-[0.028]" />

      {/* Blue glow — top center */}
      <div
        className="absolute -top-48 left-1/2 h-[560px] w-[900px] -translate-x-1/2 rounded-full bg-blue-600/20 blur-[160px]"
        style={{ animation: "glow-float 14s ease-in-out infinite" }}
      />

      {/* Indigo glow — bottom left */}
      <div
        className="absolute -bottom-24 -left-24 h-[420px] w-[580px] rounded-full bg-indigo-700/20 blur-[130px]"
        style={{ animation: "glow-drift 20s ease-in-out infinite" }}
      />

      {/* Purple accent — right mid */}
      <div
        className="absolute top-1/3 -right-40 h-[340px] w-[480px] -translate-y-1/2 rounded-full bg-purple-700/15 blur-[110px]"
        style={{ animation: "glow-drift 26s ease-in-out infinite reverse" }}
      />
    </div>
  );
}

"use client";

export default function AnimatedBackground() {
  return (
    <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden bg-black">
      {/* Soft glow layer */}
      <div
        className="absolute inset-0"
        style={{
          background: `
            radial-gradient(circle at 50% 10%, rgba(59,130,246,0.28), transparent 35%),
            radial-gradient(circle at 80% 70%, rgba(139,92,246,0.18), transparent 30%),
            radial-gradient(circle at 20% 80%, rgba(34,211,238,0.12), transparent 35%),
            #000000
          `,
        }}
      />

      {/* Blue grid layer */}
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

      {/* Dot texture */}
      <div
        className="absolute inset-0 opacity-10"
        style={{
          backgroundImage:
            "radial-gradient(rgba(255,255,255,0.35) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* Ripple rings */}
      <div className="absolute left-1/2 top-1/2 h-[420px] w-[420px] rounded-full border border-blue-500/20 animate-[ripple_8s_ease-out_infinite]" />
      <div className="absolute left-1/2 top-1/2 h-[620px] w-[620px] rounded-full border border-blue-400/15 animate-[ripple_8s_ease-out_infinite_1.5s]" />
      <div className="absolute left-1/2 top-1/2 h-[820px] w-[820px] rounded-full border border-cyan-400/10 animate-[ripple_8s_ease-out_infinite_3s]" />

      {/* Extra blur glow */}
      <div className="absolute left-1/2 top-0 h-[500px] w-[900px] -translate-x-1/2 rounded-full bg-blue-500/10 blur-[120px]" />
    </div>
  );
}

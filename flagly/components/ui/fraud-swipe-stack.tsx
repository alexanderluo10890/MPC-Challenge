"use client";

import {
  animate,
  AnimatePresence,
  motion,
  useMotionValue,
  useTransform,
  type MotionValue,
} from "framer-motion";
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Info,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FraudCase, Severity } from "@/app/mock-data";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function animateMV(mv: MotionValue<number>, target: number, options: object = {}) {
  return new Promise<void>((resolve) =>
    animate(mv, target, { ...options, onComplete: resolve }),
  );
}

const severityStyles: Record<Severity, { bg: string; text: string; border: string; score: string }> = {
  Critical: { bg: "bg-red-50",    text: "text-red-700",    border: "border-red-200",    score: "text-red-600"    },
  High:     { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", score: "text-orange-500" },
  Medium:   { bg: "bg-amber-50",  text: "text-amber-700",  border: "border-amber-200",  score: "text-amber-500"  },
  Low:      { bg: "bg-slate-50",  text: "text-slate-700",  border: "border-slate-200",  score: "text-slate-600"  },
};

// ─── Types ────────────────────────────────────────────────────────────────────

export type SwipeSessionStats = {
  approved: number;
  escalated: number;
  review: number;
};

export interface FraudSwipeStackProps {
  cases: FraudCase[];
  onApprove: (caseId: string) => void;
  onFraud: (caseId: string) => void;
  onReview?: (caseId: string) => void;
  onComplete?: () => void;
  totalCasesInQueue: number;
  startIndexOffset?: number;
  sessionStats: SwipeSessionStats;
}

// ─── Main component ───────────────────────────────────────────────────────────

export function FraudSwipeStack({
  cases,
  onApprove,
  onFraud,
  onReview,
  onComplete,
  totalCasesInQueue,
  startIndexOffset = 0,
  sessionStats,
}: FraudSwipeStackProps) {
  // Internal queue — snapshot of `cases` so parent prop mutations (caused by
  // our own callbacks updating statuses) never touch in-flight animations.
  // Calling onApprove/onFraud immediately caused the parent to filter that
  // case out of `unreviewedCases`, shrink the `cases` prop, and unmount the
  // card mid-animation. Now we manage our own queue and fire callbacks only
  // after the exit animation completes.
  const [queue, setQueue] = useState<FraudCase[]>(() => [...cases]);
  const [initialQueueLength] = useState(cases.length);

  const [detailCase, setDetailCase] = useState<FraudCase | null>(null);
  const swipingRef = useRef(false);

  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotate = useTransform(x, [-220, 220], [-20, 20]);
  const rightOpacity = useTransform(x, [35, 95], [0, 1]);
  const leftOpacity  = useTransform(x, [-95, -35], [1, 0]);
  const downOpacity  = useTransform(y, [35, 95], [0, 1]);

  const isDone = queue.length === 0;
  const visibleCases = queue.slice(0, 3);

  const swipe = useCallback(
    (dir: "left" | "right" | "down") => {
      if (swipingRef.current || queue.length === 0) return;
      const fraudCase = queue[0];
      if (!fraudCase) return;

      swipingRef.current = true;

      const xTarget = dir === "right" ? 620 : dir === "left" ? -620 : 0;
      const yTarget = dir === "down" ? 620 : dir === "right" ? -40 : 40;

      void Promise.all([
        animateMV(x, xTarget, { duration: 0.3, ease: [0.4, 0, 1, 1] }),
        animateMV(y, yTarget, { duration: 0.3, ease: [0.4, 0, 1, 1] }),
      ]).then(() => {
        x.set(0);
        y.set(0);
        // Callbacks fire after animation — parent re-renders can't unmount
        // the card that was just animating (it's already gone from our queue).
        if (dir === "right") onApprove(fraudCase.transaction_id);
        else if (dir === "left") onFraud(fraudCase.transaction_id);
        else onReview?.(fraudCase.transaction_id);
        setQueue((prev) => prev.slice(1));
        swipingRef.current = false;
      });
    },
    [queue, onApprove, onFraud, onReview, x, y],
  );

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.isContentEditable;
      if (isTyping) return;
      if (e.key === "ArrowRight") { e.preventDefault(); void swipe("right"); }
      else if (e.key === "ArrowLeft") { e.preventDefault(); void swipe("left"); }
      else if (e.key === "ArrowDown") { e.preventDefault(); void swipe("down"); }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [swipe]);

  // Notify parent when the queue is fully processed
  useEffect(() => {
    if (isDone && initialQueueLength > 0) onComplete?.();
  }, [initialQueueLength, isDone, onComplete]);

  const progress = totalCasesInQueue === 0 ? 0 : Math.min((startIndexOffset / totalCasesInQueue) * 100, 100);
  const caseNum = Math.min(startIndexOffset + 1, totalCasesInQueue);

  // ── Done state ──
  if (isDone) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
          <CheckCircle2 className="h-8 w-8 text-emerald-600" />
        </div>
        <h2 className="mt-4 text-2xl font-semibold text-zinc-950">Queue cleared.</h2>
        <p className="mt-2 text-sm text-zinc-500">No more unreviewed cases in the swipe queue.</p>
        <div className="mt-6 flex items-center gap-4 text-sm text-zinc-500">
          <span className="flex items-center gap-1.5 font-medium text-emerald-600">
            <BadgeCheck className="h-4 w-4" /> {sessionStats.approved} approved
          </span>
          <span className="flex items-center gap-1.5 font-medium text-red-600">
            <ShieldAlert className="h-4 w-4" /> {sessionStats.escalated} escalated
          </span>
          {sessionStats.review > 0 && (
            <span className="flex items-center gap-1.5 font-medium text-amber-600">
              <Clock3 className="h-4 w-4" /> {sessionStats.review} dismissed
            </span>
          )}
        </div>
      </div>
    );
  }

  // ── Main render ──
  return (
    <div className="flex flex-col items-center px-4 py-6">
      {/* Progress header */}
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-zinc-950">
            Case {caseNum} of {totalCasesInQueue}
          </span>
          <div className="flex items-center gap-3">
            <StatChip icon={BadgeCheck} count={sessionStats.approved}  color="text-emerald-600" />
            <StatChip icon={ShieldAlert} count={sessionStats.escalated} color="text-red-600"     />
            {sessionStats.review > 0 && (
              <StatChip icon={Clock3} count={sessionStats.review} color="text-amber-600" />
            )}
          </div>
        </div>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-zinc-100">
          <div
            className="h-full rounded-full bg-zinc-950 transition-[width] duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Card stack */}
      <div className="relative mt-5 w-full max-w-sm" style={{ height: 520 }}>
        {visibleCases.map((fraudCase, i) => {
          const isTop = i === 0;
          const scale = 1 - i * 0.04;
          const yOffset = i * 14;

          return (
            <motion.div
              key={fraudCase.transaction_id}
              className="absolute inset-0"
              style={
                isTop
                  ? { x, y, rotate, zIndex: 30 }
                  : { zIndex: 30 - i * 10 }
              }
              // Top card: omit `y` from animate — the motion value in `style`
              // owns the y axis. Including y here creates two controllers on
              // the same property and the animate controller wins, blocking
              // animateMV from moving the card off-screen.
              initial={isTop
                ? { scale: 1, opacity: 0 }
                : { scale, y: yOffset + 20, opacity: 0 }
              }
              animate={isTop
                ? { scale: 1, opacity: 1 }
                : { scale, y: yOffset, opacity: 1 }
              }
              transition={{ duration: 0.3, ease: "easeOut" }}
              drag={isTop}
              // Large box so there is no effective boundary and no spring-back
              // force on release. With tight constraints (left:0, right:0) Framer
              // fires a spring back to 0 the moment onDragEnd fires, which
              // directly fights our animateMV call and causes cards to stick.
              dragConstraints={{ left: -1000, right: 1000, top: -1000, bottom: 1000 }}
              dragElastic={0.1}
              // Disable momentum so the card stops exactly where the finger
              // lifts — no Framer-internal velocity animation to compete with.
              dragMomentum={false}
              onDragEnd={(_, info) => {
                if (swipingRef.current) return;
                const absX = Math.abs(info.offset.x);
                const absY = info.offset.y;
                if (absX > 80 && absX > Math.abs(absY)) {
                  swipe(info.offset.x > 0 ? "right" : "left");
                } else if (absY > 80 && absY > absX) {
                  swipe("down");
                } else {
                  void animateMV(x, 0, { type: "spring", stiffness: 380, damping: 28 });
                  void animateMV(y, 0, { type: "spring", stiffness: 380, damping: 28 });
                }
              }}
            >
              <div
                className={`relative h-full w-full overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-xl ${isTop ? "cursor-grab active:cursor-grabbing" : ""}`}
              >
                {/* Directional overlays — top card only */}
                {isTop && (
                  <>
                    <SwipeOverlay
                      opacity={rightOpacity}
                      color="bg-emerald-500"
                      icon={<BadgeCheck className="h-14 w-14 text-white" />}
                      label="LEGITIMATE"
                    />
                    <SwipeOverlay
                      opacity={leftOpacity}
                      color="bg-red-500"
                      icon={<ShieldAlert className="h-14 w-14 text-white" />}
                      label="FRAUD"
                    />
                    <SwipeOverlay
                      opacity={downOpacity}
                      color="bg-amber-400"
                      icon={<ChevronDown className="h-14 w-14 text-white" />}
                      label="DISMISS"
                    />
                  </>
                )}

                <CardContent
                  fraudCase={fraudCase}
                  onViewDetails={() => setDetailCase(fraudCase)}
                />
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="mt-5 flex w-full max-w-sm items-center gap-2">
        <ActionButton
          onClick={() => void swipe("left")}
          label="Escalate"
          icon={<ShieldAlert className="h-4 w-4" />}
          className="flex-1 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus-visible:outline-red-500"
          aria-label="Escalate as fraud - Left arrow"
        />
        <ActionButton
          onClick={() => void swipe("down")}
          label="Dismiss"
          icon={<ChevronDown className="h-4 w-4" />}
          className="border-zinc-200 bg-zinc-50 px-3 text-zinc-600 hover:bg-zinc-100 focus-visible:outline-zinc-500"
          aria-label="Dismiss flag - Down arrow"
        />
        <ActionButton
          onClick={() => void swipe("right")}
          label="Approve"
          icon={<BadgeCheck className="h-4 w-4" />}
          className="flex-1 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus-visible:outline-emerald-500"
          aria-label="Approve as legitimate - Right arrow"
        />
      </div>

      {/* Keyboard hint */}
      <p className="mt-3 text-center text-xs text-zinc-400">
        <kbd className="font-mono">←</kbd> Escalate &nbsp;·&nbsp;
        <kbd className="font-mono">→</kbd> Approve &nbsp;·&nbsp;
        <kbd className="font-mono">↓</kbd> Dismiss
      </p>

      {/* Detail drawer */}
      <AnimatePresence>
        {detailCase && (
          <DetailDrawer
            fraudCase={detailCase}
            onClose={() => setDetailCase(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SwipeOverlay({
  opacity,
  color,
  icon,
  label,
}: {
  opacity: MotionValue<number>;
  color: string;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <motion.div
      className={`pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-2xl ${color}`}
      style={{ opacity }}
    >
      {icon}
      <span className="text-2xl font-black tracking-widest text-white">{label}</span>
    </motion.div>
  );
}

function StatChip({
  icon: Icon,
  count,
  color,
}: {
  icon: React.ComponentType<{ className?: string }>;
  count: number;
  color: string;
}) {
  return (
    <span className={`flex items-center gap-1 text-xs font-semibold ${color}`}>
      <Icon className="h-3.5 w-3.5" />
      {count}
    </span>
  );
}

function ActionButton({
  onClick,
  label,
  icon,
  className,
  "aria-label": ariaLabel,
}: {
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  className: string;
  "aria-label": string;
}) {
  return (
    <button
      aria-label={ariaLabel}
      className={`inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border py-3 text-sm font-semibold transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ${className}`}
      onClick={onClick}
      type="button"
    >
      {icon}
      {label}
    </button>
  );
}

// ─── Card content (no drag interference — pointer-events handled by parent) ───

function CardContent({
  fraudCase,
  onViewDetails,
}: {
  fraudCase: FraudCase;
  onViewDetails: () => void;
}) {
  const sev = severityStyles[fraudCase.severity];
  const isForeign = fraudCase.cardholder_country !== fraudCase.merchant_country;
  const isNewDevice = Boolean(fraudCase.device_id && !fraudCase.device_id.includes("known"));

  // Concise risk chips derived from baseline + metadata
  const chips: string[] = [];
  if (fraudCase.baseline.amount_ratio >= 2)
    chips.push(`${fraudCase.baseline.amount_ratio}× normal spend`);
  if (isNewDevice) chips.push("New device");
  if (fraudCase.ip_address) chips.push("New IP");
  if (isForeign) chips.push(`Foreign: ${fraudCase.merchant_country}`);

  return (
    <div className="flex h-full select-none flex-col p-5">
      {/* Risk score + severity */}
      <div className="flex items-start justify-between gap-2">
        <span
          className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${sev.border} ${sev.bg} ${sev.text}`}
        >
          {fraudCase.severity}
        </span>
        <div className="text-right">
          <div className={`text-5xl font-black tabular-nums leading-none ${sev.score}`}>
            {fraudCase.fraud_score}
          </div>
          <div className="mt-0.5 text-xs font-medium text-zinc-400">/ 100</div>
        </div>
      </div>

      {/* Amount + merchant */}
      <div className="mt-4">
        <div className="text-3xl font-bold tracking-tight text-zinc-950">
          {money.format(fraudCase.amount)}
        </div>
        <div className="mt-1 text-base font-semibold text-zinc-700">
          {fraudCase.merchant_name}
        </div>
        <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">
          <span className="capitalize">{fraudCase.channel.replace("_", " ")}</span>
          <span>·</span>
          <span>
            {fraudCase.cardholder_country}
            {isForeign ? ` → ${fraudCase.merchant_country}` : ""}
          </span>
        </div>
      </div>

      {/* Risk signal chips */}
      {chips.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-1.5">
          {chips.map((chip) => (
            <span
              key={chip}
              className="rounded-full border border-red-200 bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700"
            >
              {chip}
            </span>
          ))}
        </div>
      )}

      {/* Why flagged — top 3 reasons */}
      <div className="mt-4 flex-1">
        <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-zinc-400">
          <AlertTriangle className="h-3.5 w-3.5" />
          Why flagged
        </div>
        <ul className="mt-2 space-y-2">
          {fraudCase.reasons.slice(0, 3).map((reason) => (
            <li key={reason} className="flex items-start gap-2 text-sm leading-5 text-zinc-700">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-red-500" />
              {reason}
            </li>
          ))}
        </ul>
        {fraudCase.reasons.length > 3 && (
          <p className="mt-2 text-xs text-zinc-400">
            +{fraudCase.reasons.length - 3} more signals in details
          </p>
        )}
      </div>

      {/* View details button */}
      <button
        className="mt-4 flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-zinc-200 bg-zinc-50 py-2.5 text-sm font-medium text-zinc-600 transition-colors duration-200 hover:bg-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
        onClick={(e) => {
          e.stopPropagation();
          onViewDetails();
        }}
        type="button"
        aria-label="View full case details"
      >
        <Info className="h-4 w-4" />
        View Full Details
      </button>
    </div>
  );
}

// ─── Detail full-page view ────────────────────────────────────────────────────

function PageSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-zinc-400">{title}</h3>
      {children}
    </section>
  );
}

function DetailDrawer({
  fraudCase,
  onClose,
}: {
  fraudCase: FraudCase;
  onClose: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const sev = severityStyles[fraudCase.severity];
  const isForeign = fraudCase.cardholder_country !== fraudCase.merchant_country;
  const isNewDevice = Boolean(fraudCase.device_id && !fraudCase.device_id.includes("known"));

  // Spend bar: how wide is the "normal" portion vs the excess
  const barNormalPct = Math.min(
    (fraudCase.baseline.median_amount / fraudCase.amount) * 100,
    100,
  );

  // Signal severity: first 2 = high-priority (red), rest = medium (amber)
  const signalPriority = (i: number) =>
    i < 2 ? "border-red-200 bg-red-50 text-red-800" : "border-amber-200 bg-amber-50 text-amber-800";

  const timelineStyles: Record<string, { bar: string; badge: string; label: string }> = {
    critical: { bar: "bg-red-500",    badge: "bg-red-100 text-red-700",    label: "Critical"  },
    warning:  { bar: "bg-amber-400",  badge: "bg-amber-100 text-amber-700", label: "Warning"   },
    normal:   { bar: "bg-emerald-500",badge: "bg-emerald-100 text-emerald-700",label: "Normal"  },
    review:   { bar: "bg-sky-400",    badge: "bg-sky-100 text-sky-700",    label: "Review"    },
  };

  // Full-screen page — slides in from the right like a navigation page
  return (
    <motion.div
      className="fixed inset-0 z-50 overflow-y-auto bg-[#f5f7f8]"
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${fraudCase.transaction_id}`}
      initial={{ x: "100%" }}
      animate={{ x: 0 }}
      exit={{ x: "100%" }}
      transition={{ type: "spring", damping: 32, stiffness: 300 }}
    >
      {/* ── STICKY PAGE HEADER ──────────────────────────────────────────── */}
      <div className="sticky top-0 z-10 border-b border-zinc-200 bg-white/90 backdrop-blur-md">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <button
            className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-700 shadow-sm transition-colors hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={onClose}
            type="button"
            aria-label="Back to review"
          >
            <X className="h-4 w-4" />
            Back to Review
          </button>
          <div className="min-w-0 flex-1">
            <p className="truncate font-mono text-sm font-semibold text-zinc-400">
              {fraudCase.transaction_id} · {fraudCase.card_id}
            </p>
          </div>
          <span className={`inline-flex shrink-0 rounded-full border px-3 py-1 text-sm font-bold ${sev.border} ${sev.bg} ${sev.text}`}>
            {fraudCase.severity}
          </span>
        </div>
      </div>

      {/* ── PAGE CONTENT ───────────────────────────────────────────────── */}
      <div className="mx-auto max-w-5xl px-6 pb-16 pt-8">

        {/* Hero row */}
        <div>
          <h1 className="text-4xl font-bold text-zinc-950">{fraudCase.merchant_name}</h1>
          <p className="mt-2 text-base text-zinc-500">
            {fraudCase.timestamp} · {fraudCase.channel.replace("_", " ")} ·{" "}
            {fraudCase.cardholder_country}
            {isForeign ? ` → ${fraudCase.merchant_country}` : ""}
          </p>
        </div>

        {/* KPI row — 3 large cards */}
        <div className="mt-6 grid grid-cols-3 gap-4">
          <div className={`rounded-2xl border p-6 ${sev.border} ${sev.bg}`}>
            <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Risk Score</p>
            <p className={`mt-3 text-7xl font-black tabular-nums leading-none ${sev.score}`}>
              {fraudCase.fraud_score}
            </p>
            <p className="mt-2 text-base font-medium text-zinc-500">out of 100</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">Amount</p>
            <p className="mt-3 text-4xl font-black tabular-nums leading-none text-zinc-950">
              {money.format(fraudCase.amount)}
            </p>
            <p className="mt-2 text-base font-medium capitalize text-zinc-500">
              {fraudCase.channel.replace("_", " ")}
            </p>
          </div>
          <div className="rounded-2xl border border-red-200 bg-red-50 p-6">
            <p className="text-sm font-semibold uppercase tracking-wider text-zinc-500">vs. Normal</p>
            <p className="mt-3 text-7xl font-black tabular-nums leading-none text-red-600">
              {fraudCase.baseline.amount_ratio}×
            </p>
            <p className="mt-2 text-base font-medium text-zinc-500">
              median {money.format(fraudCase.baseline.median_amount)}
            </p>
          </div>
        </div>

        {/* Two-column layout below KPIs */}
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_380px]">

          {/* LEFT column: signals + timeline */}
          <div className="space-y-8">
            <PageSection title="Fraud Signals">
              <ul className="space-y-3">
                {fraudCase.reasons.map((reason, i) => (
                  <li
                    key={reason}
                    className={`flex items-start gap-4 rounded-2xl border px-5 py-4 text-base leading-7 ${signalPriority(i)}`}
                  >
                    <AlertTriangle className="mt-1 h-5 w-5 shrink-0" />
                    {reason}
                  </li>
                ))}
              </ul>
            </PageSection>

            {fraudCase.timeline.length > 0 && (
              <PageSection title="Event Timeline">
                <ol className="space-y-3">
                  {fraudCase.timeline.map((event) => {
                    const ts = timelineStyles[event.type] ?? timelineStyles.normal;
                    return (
                      <li
                        key={`${event.time}-${event.label}`}
                        className="flex overflow-hidden rounded-2xl border border-zinc-200 bg-white"
                      >
                        <div className={`w-2 shrink-0 ${ts.bar}`} />
                        <div className="flex flex-1 items-start gap-5 px-5 py-5">
                          <div className="flex shrink-0 flex-col items-start gap-2">
                            <span className="font-mono text-base font-bold text-zinc-600">
                              {event.time}
                            </span>
                            <span className={`rounded-full px-2.5 py-1 text-xs font-bold uppercase tracking-wide ${ts.badge}`}>
                              {ts.label}
                            </span>
                          </div>
                          <div className="min-w-0">
                            <p className="text-lg font-semibold text-zinc-900">{event.label}</p>
                            <p className="mt-1.5 text-base leading-7 text-zinc-500">{event.description}</p>
                          </div>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </PageSection>
            )}
          </div>

          {/* RIGHT column: spend comparison + related activity */}
          <div className="space-y-8">
            <PageSection title="Spend Comparison">
              <div className="rounded-2xl border border-zinc-200 bg-white p-6">
                <div className="flex items-end justify-between gap-2">
                  <div>
                    <p className="text-sm text-zinc-500">Normal median</p>
                    <p className="mt-0.5 text-xl font-bold text-zinc-800">
                      {money.format(fraudCase.baseline.median_amount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm text-zinc-500">This transaction</p>
                    <p className="mt-0.5 text-xl font-bold text-red-600">
                      {money.format(fraudCase.amount)}
                    </p>
                  </div>
                </div>
                <div className="relative mt-4 h-5 overflow-hidden rounded-full bg-zinc-100">
                  <div
                    className="absolute left-0 top-0 h-full rounded-full bg-emerald-500"
                    style={{ width: `${barNormalPct}%` }}
                  />
                  <div
                    className="absolute top-0 h-full rounded-full bg-red-500"
                    style={{ left: `${barNormalPct}%`, right: 0 }}
                  />
                </div>
                <p className="mt-2 text-right text-sm font-semibold text-red-500">
                  {fraudCase.baseline.amount_ratio}× over median
                </p>

                <div className="mt-5 grid grid-cols-2 gap-4 border-t border-zinc-100 pt-5">
                  {[
                    ["Usual countries", fraudCase.baseline.usual_countries.join(", "), false],
                    ["Merchant country", fraudCase.merchant_country, isForeign],
                    ["Usual categories", fraudCase.baseline.common_categories.slice(0, 2).join(", "), false],
                    ["Known devices", String(fraudCase.baseline.known_devices_count), false],
                  ].map(([label, value, highlight]) => (
                    <div key={String(label)}>
                      <p className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{label}</p>
                      <p className={`mt-1 text-base font-semibold ${highlight ? "text-red-600" : "text-zinc-800"}`}>
                        {value}
                        {label === "Merchant country" && isForeign && " ✗"}
                        {label === "Usual countries" && !isForeign && " ✓"}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            </PageSection>

            {fraudCase.related_activity.length > 0 && (
              <PageSection title={`Related Activity (${fraudCase.related_activity.length})`}>
                <div className="space-y-3">
                  {fraudCase.related_activity.map((item) => (
                    <div
                      key={item.transaction_id}
                      className="flex items-start gap-4 rounded-2xl border border-zinc-200 bg-white px-5 py-4"
                    >
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-zinc-100">
                        <ShieldAlert className="h-5 w-5 text-zinc-500" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="font-mono text-sm font-semibold text-zinc-500">
                            {item.transaction_id}
                          </span>
                          <span className="shrink-0 text-base font-bold text-zinc-900">
                            {money.format(item.amount)}
                          </span>
                        </div>
                        <p className="mt-1 text-base font-medium text-zinc-700">{item.merchant_name}</p>
                        <p className="mt-0.5 text-sm text-zinc-400">{item.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </PageSection>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

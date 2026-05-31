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
  RotateCcw,
  ShieldAlert,
  X,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FraudCase, ReviewStatus, Severity } from "@/app/mock-data";

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
  Low:      { bg: "bg-emerald-50",text: "text-emerald-700",border: "border-emerald-200",score: "text-emerald-600"},
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
  const initialLengthRef = useRef(cases.length);

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
    if (isDone && initialLengthRef.current > 0) onComplete?.();
  }, [isDone, onComplete]);

  const processedCount = initialLengthRef.current - queue.length;
  const progress = initialLengthRef.current === 0 ? 0 : Math.min((processedCount / initialLengthRef.current) * 100, 100);
  const caseNum = startIndexOffset + processedCount + 1;

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
              <Clock3 className="h-4 w-4" /> {sessionStats.review} deferred
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
                      label="REVIEW"
                    />
                  </>
                )}

                <CardContent
                  fraudCase={fraudCase}
                  isTop={isTop}
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
          label="Fraud"
          icon={<ShieldAlert className="h-4 w-4" />}
          className="flex-1 border-red-200 bg-red-50 text-red-700 hover:bg-red-100 focus-visible:outline-red-500"
          aria-label="Escalate as fraud — Left arrow"
        />
        <ActionButton
          onClick={() => void swipe("down")}
          label="Review"
          icon={<ChevronDown className="h-4 w-4" />}
          className="border-zinc-200 bg-zinc-50 px-3 text-zinc-600 hover:bg-zinc-100 focus-visible:outline-zinc-500"
          aria-label="Mark for manual review — Down arrow"
        />
        <ActionButton
          onClick={() => void swipe("right")}
          label="Legitimate"
          icon={<BadgeCheck className="h-4 w-4" />}
          className="flex-1 border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 focus-visible:outline-emerald-500"
          aria-label="Approve as legitimate — Right arrow"
        />
      </div>

      {/* Keyboard hint */}
      <p className="mt-3 text-center text-xs text-zinc-400">
        <kbd className="font-mono">←</kbd> Fraud &nbsp;·&nbsp;
        <kbd className="font-mono">→</kbd> Legitimate &nbsp;·&nbsp;
        <kbd className="font-mono">↓</kbd> Review
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
  isTop,
  onViewDetails,
}: {
  fraudCase: FraudCase;
  isTop: boolean;
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

// ─── Detail drawer ────────────────────────────────────────────────────────────

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

  const timelineColor: Record<string, string> = {
    critical: "bg-red-500",
    warning: "bg-amber-400",
    normal: "bg-emerald-400",
    review: "bg-sky-400",
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-label={`Details for ${fraudCase.transaction_id}`}
    >
      {/* Backdrop */}
      <motion.div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />

      {/* Sheet */}
      <motion.div
        className="relative z-10 max-h-[88vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl"
        initial={{ y: "100%" }}
        animate={{ y: 0 }}
        exit={{ y: "100%" }}
        transition={{ type: "spring", damping: 30, stiffness: 280 }}
      >
        {/* Handle bar (mobile) */}
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="h-1 w-10 rounded-full bg-zinc-300" />
        </div>

        <div className="p-6">
          {/* Header */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="font-mono text-xs font-semibold text-zinc-400">
                {fraudCase.transaction_id} · {fraudCase.card_id}
              </p>
              <h2 className="mt-1 text-xl font-semibold text-zinc-950">
                {fraudCase.merchant_name}
              </h2>
              <p className="mt-0.5 text-sm text-zinc-500">
                {new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(fraudCase.amount)}
                {" · "}
                {fraudCase.timestamp}
              </p>
            </div>
            <button
              className="cursor-pointer rounded-lg p-1.5 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={onClose}
              type="button"
              aria-label="Close details"
            >
              <X className="h-5 w-5" />
            </button>
          </div>

          {/* All fraud signals */}
          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              All Fraud Signals
            </h3>
            <ul className="mt-3 space-y-2">
              {fraudCase.reasons.map((reason) => (
                <li key={reason} className="flex items-start gap-2.5 text-sm text-zinc-700">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                  {reason}
                </li>
              ))}
            </ul>
          </section>

          {/* Baseline comparison */}
          <section className="mt-6">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              Baseline vs. This Transaction
            </h3>
            <div className="mt-3 space-y-2 rounded-xl border border-zinc-100 bg-zinc-50 p-4">
              {[
                ["Median spend", money.format(fraudCase.baseline.median_amount)],
                [
                  "This transaction",
                  `${money.format(fraudCase.amount)} (${fraudCase.baseline.amount_ratio}×)`,
                  fraudCase.baseline.amount_ratio >= 3 ? "font-semibold text-red-600" : "font-semibold text-zinc-900",
                ],
                ["Usual categories", fraudCase.baseline.common_categories.slice(0, 3).join(", ")],
                ["Usual countries",  fraudCase.baseline.usual_countries.join(", ")],
                ["Known devices",    String(fraudCase.baseline.known_devices_count)],
                ["Known IPs",        String(fraudCase.baseline.known_ips_count)],
              ].map(([label, value, valueClass]) => (
                <div key={label} className="flex items-baseline justify-between gap-4">
                  <span className="text-sm text-zinc-500">{label}</span>
                  <span className={`text-sm ${valueClass ?? "font-medium text-zinc-800"}`}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
          </section>

          {/* Timeline */}
          {fraudCase.timeline.length > 0 && (
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Event Timeline
              </h3>
              <ol className="mt-3 space-y-0">
                {fraudCase.timeline.map((event, i) => (
                  <li key={`${event.time}-${event.label}`} className="flex gap-3">
                    <div className="flex flex-col items-center">
                      <div
                        className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${timelineColor[event.type] ?? "bg-zinc-300"}`}
                      />
                      {i < fraudCase.timeline.length - 1 && (
                        <div className="mt-0.5 w-px flex-1 bg-zinc-200" />
                      )}
                    </div>
                    <div className="pb-4">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-zinc-400">
                          {event.time}
                        </span>
                        <span className="text-sm font-semibold text-zinc-900">{event.label}</span>
                      </div>
                      <p className="mt-0.5 text-sm leading-5 text-zinc-600">{event.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </section>
          )}

          {/* Related activity */}
          {fraudCase.related_activity.length > 0 && (
            <section className="mt-6">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                Related Activity
              </h3>
              <div className="mt-3 space-y-2">
                {fraudCase.related_activity.map((item) => (
                  <div
                    key={item.transaction_id}
                    className="rounded-xl border border-zinc-100 bg-zinc-50 p-3"
                  >
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-mono text-xs font-semibold text-zinc-500">
                        {item.transaction_id}
                      </span>
                      <span className="text-sm font-semibold text-zinc-900">
                        {money.format(item.amount)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-zinc-500">
                      {item.merchant_name} · {item.reason}
                    </p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </motion.div>
    </div>
  );
}

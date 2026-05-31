"use client";

import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BadgeCheck,
  Ban,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Clock3,
  Database,
  Download,
  FileText,
  Filter,
  Gauge,
  History,
  ListChecks,
  Loader2,
  RotateCcw,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
  Zap,
} from "lucide-react";
import {
  type ChangeEvent,
  type Dispatch,
  type DragEvent,
  type ComponentType,
  type RefObject,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import {
  type Channel,
  type FraudCase,
  type ReviewStatus,
  type Severity,
  csvInputFields,
  processingSteps,
} from "./mock-data";
import {
  buildExportCsv,
  buildFraudCases,
  getFlaggedCases,
  getSensitivityThreshold,
  parseTransactionsCsv,
  type ScoredTransactionCsvRow,
} from "./csv-analysis";
import {
  FraudSwipeStack,
  type SwipeSessionStats,
} from "@/components/ui/fraud-swipe-stack";
import { GooeyText } from "@/components/ui/gooey-text-morphing";
import { AnimatedBackground } from "@/components/ui/animated-background";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/pie-chart";
import {
  LabelList,
  Pie,
  PieChart as RechartsPieChart,
} from "recharts";
import { AuraBackground } from "@/components/ui/aura-background";
import { GridScan } from "@/components/ui/GridScan";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

type View = "upload" | "dashboard" | "review" | "audit" | "complete" | "swipe";
type SensitivityMode = "Conservative" | "Balanced" | "Aggressive";
type DetailTab = "Baseline" | "Related" | "Timeline" | "AI Summary";
type ToastTone = "success" | "info" | "warning" | "error";

type FiltersState = {
  severity: Severity | "All";
  status: ReviewStatus | "All";
  pattern: string;
  category: string;
  channel: Channel | "All";
};

type ToastMessage = {
  id: number;
  message: string;
  tone: ToastTone;
};

type AuditEntry = {
  id: number;
  time: string;
  transactionId: string;
  action: string;
  previousStatus: ReviewStatus;
  newStatus: ReviewStatus;
  fraudScore: number;
  severity: Severity;
  reasons: string[];
};

type LastAction = {
  caseId: string;
  previousStatus: ReviewStatus;
  newStatus: ReviewStatus;
  auditId: number;
  actionLabel: string;
};

type DatasetSummary = {
  fileName: string;
  totalTransactions: number;
  totalCards: number;
  patternsFound: number;
};

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

const number = new Intl.NumberFormat("en-US");

const defaultFilters: FiltersState = {
  severity: "All",
  status: "All",
  pattern: "All",
  category: "All",
  channel: "All",
};


const statusLabels: Record<ReviewStatus, string> = {
  unreviewed: "Unreviewed",
  approved_legitimate: "Approved legitimate",
  dismissed_flag: "Dismissed flag",
  escalated_fraud: "Escalated fraud",
};

const actionLabels: Record<
  Exclude<ReviewStatus, "unreviewed">,
  { button: string; audit: string; toast: string }
> = {
  approved_legitimate: {
    button: "Approve Legitimate",
    audit: "Approved legitimate",
    toast: "approved as legitimate",
  },
  dismissed_flag: {
    button: "Dismiss Flag",
    audit: "Dismissed flag",
    toast: "dismissed as a false positive",
  },
  escalated_fraud: {
    button: "Escalate Fraud",
    audit: "Escalated fraud",
    toast: "escalated as likely fraud",
  },
};

const patternLabels: Record<string, string> = {
  account_takeover: "Account takeover",
  gift_card_cashout: "Gift card cash-out",
  card_testing: "Card testing",
  merchant_burst: "Merchant burst",
  cross_card_ip_reuse: "Cross-card IP reuse",
  foreign_high_value: "Foreign high value",
  amount_anomaly: "Amount anomaly",
};

const severityOrder: Record<Severity, number> = {
  Low: 1,
  Medium: 2,
  High: 3,
  Critical: 4,
};

const statusTone: Record<ReviewStatus, string> = {
  unreviewed: "border-zinc-200 bg-white text-zinc-700",
  approved_legitimate: "border-emerald-200 bg-emerald-50 text-emerald-800",
  dismissed_flag: "border-zinc-300 bg-zinc-100 text-zinc-700",
  escalated_fraud: "border-red-200 bg-red-50 text-red-800",
};

const detectorKnobs = [
  {
    label: "Amount anomaly",
    value: "3x, 5x, 10x median",
    description: "Rewards transactions that are far above a card's usual spend.",
  },
  {
    label: "Velocity windows",
    value: "30 min, 1 h, 2 h",
    description: "Looks for bursty activity across short time windows.",
  },
  {
    label: "Identity reuse",
    value: "Device/IP shared",
    description: "Boosts risk when a device or IP is reused across cards.",
  },
  {
    label: "Merchant burst",
    value: "1 h / 2 h lookbacks",
    description: "Highlights rapid spikes in unique cards or high-value traffic at one merchant.",
  },
  {
    label: "Category bursts",
    value: "24 h windows",
    description: "Surfaces repeated gift card or electronics purchases on the same card.",
  },
  {
    label: "Dormancy trigger",
    value: "7 days inactive",
    description: "Adds risk when a card reappears after a long gap.",
  },
] as const;

const wait = (ms: number) =>
  new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });

function withStatuses(
  cases: FraudCase[],
  statuses: Record<string, ReviewStatus>,
) {
  return cases.map((fraudCase) => ({
    ...fraudCase,
    review_status: statuses[fraudCase.transaction_id] ?? fraudCase.review_status,
  }));
}

function filterCases(
  cases: FraudCase[],
  filters: FiltersState,
  searchTerm: string,
) {
  const query = searchTerm.trim().toLowerCase();

  return cases.filter((fraudCase) => {
    const matchesQuery =
      query.length === 0 ||
      [
        fraudCase.transaction_id,
        fraudCase.merchant_name,
        fraudCase.card_id,
        fraudCase.ip_address,
        fraudCase.device_id,
      ]
        .filter(Boolean)
        .some((field) => field!.toLowerCase().includes(query));

    return (
      matchesQuery &&
      (filters.severity === "All" || fraudCase.severity === filters.severity) &&
      (filters.status === "All" ||
        fraudCase.review_status === filters.status) &&
      (filters.pattern === "All" ||
        fraudCase.detected_patterns.includes(filters.pattern)) &&
      (filters.category === "All" ||
        fraudCase.merchant_category === filters.category) &&
      (filters.channel === "All" || fraudCase.channel === filters.channel)
    );
  });
}

// ─── Feedback loop: learn from reviewer dismissals ────────────────────────────
// After the reviewer dismisses the same fraud pattern this many times, the queue
// treats further flags of that pattern as likely false positives and de-prioritizes
// them. Set low enough to adapt quickly within a single review session.
const DISMISS_SUPPRESS_THRESHOLD = 2;

/** Count how many times each pattern has been dismissed as a false positive. */
function getDismissalsByPattern(cases: FraudCase[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const fraudCase of cases) {
    if (fraudCase.review_status === "dismissed_flag") {
      for (const pattern of fraudCase.detected_patterns) {
        counts[pattern] = (counts[pattern] ?? 0) + 1;
      }
    }
  }
  return counts;
}

/** Patterns the reviewer has dismissed enough to suppress going forward. */
function getSuppressedPatterns(cases: FraudCase[]): Set<string> {
  const counts = getDismissalsByPattern(cases);
  return new Set(
    Object.entries(counts)
      .filter(([, count]) => count >= DISMISS_SUPPRESS_THRESHOLD)
      .map(([pattern]) => pattern),
  );
}

/** An unreviewed flag whose pattern the reviewer has repeatedly dismissed. */
function caseIsSuppressed(fraudCase: FraudCase, suppressed: Set<string>): boolean {
  return (
    fraudCase.review_status === "unreviewed" &&
    suppressed.size > 0 &&
    fraudCase.detected_patterns.some((pattern) => suppressed.has(pattern))
  );
}

/** Sort by risk, but sink suppressed (learned false-positive) flags to the bottom. */
function sortCasesByRisk(cases: FraudCase[], suppressed: Set<string>): FraudCase[] {
  return [...cases].sort((a, b) => {
    const suppressedA = caseIsSuppressed(a, suppressed) ? 1 : 0;
    const suppressedB = caseIsSuppressed(b, suppressed) ? 1 : 0;
    if (suppressedA !== suppressedB) {
      return suppressedA - suppressedB;
    }
    return (
      b.fraud_score - a.fraud_score ||
      severityOrder[b.severity] - severityOrder[a.severity]
    );
  });
}

function formatPattern(pattern: string) {
  return patternLabels[pattern] ?? pattern.replaceAll("_", " ");
}

function titleCase(value: string) {
  return value
    .replaceAll("_", " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatChannel(channel: Channel | string) {
  return channel === "in_person" ? "In person" : titleCase(channel);
}

function formatShortDate(timestamp: string) {
  return timestamp.replace("2026-", "").replace(" ", "  ");
}

function makeSummary(fraudCase: FraudCase) {
  const patternTitle = fraudCase.detected_patterns
    .slice(0, 2)
    .map(formatPattern)
    .join(" followed by ");

  return `This case resembles ${patternTitle.toLowerCase()}. The card normally has ${fraudCase.baseline.common_categories
    .slice(0, 2)
    .join(" and ")} activity, but this transaction is a ${money.format(
      fraudCase.amount,
    )} ${formatChannel(fraudCase.channel).toLowerCase()} ${fraudCase.merchant_category.replaceAll(
      "_",
      " ",
    )} purchase from ${fraudCase.merchant_country === fraudCase.cardholder_country
      ? "a new merchant"
      : "a foreign merchant country"
    }. The score remains based only on deterministic signals.`;
}

function createStatusMap(cases: FraudCase[]) {
  return Object.fromEntries(
    cases.map((fraudCase) => [
      fraudCase.transaction_id,
      fraudCase.review_status,
    ]),
  ) as Record<string, ReviewStatus>;
}

function getDatasetSummary(
  rows: ScoredTransactionCsvRow[],
  cases: FraudCase[],
  fileName: string,
): DatasetSummary {
  return {
    fileName,
    totalTransactions: rows.length,
    totalCards: new Set(rows.map((row) => row.card_id)).size,
    patternsFound: new Set(cases.flatMap((fraudCase) => fraudCase.detected_patterns)).size,
  };
}

function getSensitivitySummary(
  mode: SensitivityMode,
  flaggedCount: number,
  totalTransactions: number,
) {
  if (mode === "Conservative") {
    return `Tuned for when a wrongly-flagged customer is the costlier mistake: ${flaggedCount} of ${totalTransactions} transactions flagged, prioritizing precision over catching every case.`;
  }
  if (mode === "Aggressive") {
    return `Tuned for when missed fraud is the costlier mistake: ${flaggedCount} of ${totalTransactions} transactions flagged, prioritizing recall and accepting more false positives.`;
  }
  return `Weighs a false positive and a missed fraud evenly: ${flaggedCount} of ${totalTransactions} transactions flagged (F1-optimal on this data).`;
}

export default function FraudFrogApp() {
  const [view, setView] = useState<View>("upload");
  const [processing, setProcessing] = useState(false);
  const [processingStep, setProcessingStep] = useState(0);
  const [sourceRows, setSourceRows] = useState<ScoredTransactionCsvRow[]>([]);
  const [sourceCsvText, setSourceCsvText] = useState<string | null>(null);
  const [isPythonScored, setIsPythonScored] = useState(false);
  const [allScoredCases, setAllScoredCases] = useState<FraudCase[]>([]);
  const [datasetSummary, setDatasetSummary] = useState<DatasetSummary>({
    fileName: "No file loaded",
    totalTransactions: 0,
    totalCards: 0,
    patternsFound: 0,
  });
  const [selectedFileName, setSelectedFileName] = useState("");
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadWarnings, setUploadWarnings] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, ReviewStatus>>({});
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [lastAction, setLastAction] = useState<LastAction | null>(null);
  const [filters, setFilters] = useState<FiltersState>(defaultFilters);
  const [searchTerm, setSearchTerm] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [activeTab, setActiveTab] = useState<DetailTab>("Baseline");
  const [sensitivity, setSensitivity] =
    useState<SensitivityMode>("Balanced");
  const [toasts, setToasts] = useState<ToastMessage[]>([]);
  const [swipeStats, setSwipeStats] = useState<SwipeSessionStats>({ approved: 0, escalated: 0, review: 0 });
  const searchInputRef = useRef<HTMLInputElement>(null);
  const prefersReducedMotion = useReducedMotion();

  const flaggedCases = useMemo(
    () => getFlaggedCases(allScoredCases, sensitivity),
    [allScoredCases, sensitivity],
  );

  const casesWithStatuses = useMemo(
    () => withStatuses(flaggedCases, statuses),
    [flaggedCases, statuses],
  );

  const suppressedPatterns = useMemo(
    () => getSuppressedPatterns(casesWithStatuses),
    [casesWithStatuses],
  );

  const sortedCases = useMemo(
    () => sortCasesByRisk(casesWithStatuses, suppressedPatterns),
    [casesWithStatuses, suppressedPatterns],
  );

  const suppressedCount = useMemo(
    () =>
      casesWithStatuses.filter((fraudCase) =>
        caseIsSuppressed(fraudCase, suppressedPatterns),
      ).length,
    [casesWithStatuses, suppressedPatterns],
  );

  const filteredCases = useMemo(
    () => filterCases(sortedCases, filters, searchTerm),
    [filters, searchTerm, sortedCases],
  );

  const safeActiveIndex =
    filteredCases.length === 0
      ? 0
      : Math.min(activeIndex, filteredCases.length - 1);
  const currentCase = filteredCases[safeActiveIndex] ?? null;
  const reviewedCount = casesWithStatuses.filter(
    (fraudCase) => fraudCase.review_status !== "unreviewed",
  ).length;
  const escalatedCount = casesWithStatuses.filter(
    (fraudCase) => fraudCase.review_status === "escalated_fraud",
  ).length;
  const reviewProgress =
    casesWithStatuses.length === 0
      ? 0
      : Math.round((reviewedCount / casesWithStatuses.length) * 100);
  const projectedFlaggedCount = casesWithStatuses.length;

  const addToast = (message: string, tone: ToastTone = "success") => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, tone }]);
    window.setTimeout(() => {
      setToasts((current) => current.filter((toast) => toast.id !== id));
    }, 4600);
  };

  const handleFileSelected = async (file: File | null) => {
    if (!file) {
      return;
    }

    try {
      const text = await file.text();
      setSourceCsvText(text);
      const parsed = parseTransactionsCsv(text);
      setSourceRows(parsed.rows);
      setIsPythonScored(parsed.isScored);
      setSelectedFileName(file.name);
      setUploadWarnings(parsed.warnings);
      setUploadError(null);
      setAllScoredCases([]);
      setDatasetSummary({
        fileName: file.name,
        totalTransactions: parsed.rows.length,
        totalCards: new Set(parsed.rows.map((row) => row.card_id)).size,
        patternsFound: 0,
      });
      setStatuses({});
      setAuditEntries([]);
      setLastAction(null);
      setFilters(defaultFilters);
      setSearchTerm("");
      setActiveIndex(0);
      addToast(
        parsed.isScored
          ? `${file.name} loaded — Python fraud scores detected (${parsed.rows.length} transactions).`
          : `${file.name} loaded with ${parsed.rows.length} valid transactions.`,
        "success",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to parse CSV.";
      setUploadError(message);
      setSourceRows([]);
      setSelectedFileName(file.name);
      setUploadWarnings([]);
      addToast(message, "error");
    }
  };

  const handleProcessTransactions = async () => {
    if (processing) {
      return;
    }

    if (sourceRows.length === 0) {
      const message = uploadError ?? "Upload a valid transactions CSV before processing.";
      setUploadError(message);
      addToast(message, "error");
      return;
    }

    setProcessing(true);
    let rowsToUse = sourceRows;

    // If the CSV wasn't already Python-scored, call the server to run fraud_detector.py
    if (!isPythonScored) {
      try {
        if (!sourceCsvText) {
          throw new Error("Raw CSV text not available for server scoring.");
        }
        const resp = await fetch("/api/score", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv: sourceCsvText, sensitivity }),
        });
        if (!resp.ok) {
          const msg = await resp.text();
          throw new Error(msg || "Server scoring failed.");
        }
        const scoredCsv = await resp.text();
        const parsed = parseTransactionsCsv(scoredCsv);
        rowsToUse = parsed.rows;
        setSourceRows(parsed.rows);
        setIsPythonScored(true);
        setUploadWarnings(parsed.warnings);
        setDatasetSummary((prev) => ({ ...prev, fileName: prev.fileName }));
        addToast(`${selectedFileName || 'transactions.csv'} scored by Python detector.`, "success");
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setProcessing(false);
        addToast(`Scoring failed: ${message}`, "error");
        return;
      }
    }
    for (let step = 0; step < processingSteps.length; step += 1) {
      setProcessingStep(step);
      await wait(700);
    }
    const scoredCases = buildFraudCases(rowsToUse);
    const nextSummary = getDatasetSummary(
      sourceRows,
      scoredCases,
      selectedFileName || "transactions.csv",
    );
    setAllScoredCases(scoredCases);
    setStatuses(createStatusMap(scoredCases));
    setDatasetSummary(nextSummary);
    setAuditEntries([]);
    setLastAction(null);
    setFilters(defaultFilters);
    setSearchTerm("");
    setActiveIndex(0);
    setProcessing(false);
    setView("dashboard");
    addToast(
      `Analysis ready. ${getFlaggedCases(scoredCases, sensitivity).length} flagged cases prepared for reviewer triage.`,
      "success",
    );
  };

  const handleExport = () => {
    const exportCases = withStatuses(allScoredCases, statuses);
    if (exportCases.length === 0) {
      addToast("Process a transactions file before exporting.", "warning");
      return;
    }

    const csv = buildExportCsv(
      exportCases,
      statuses,
      getSensitivityThreshold(sensitivity),
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const baseName = (datasetSummary.fileName || "transactions.csv").replace(
      /\.csv$/i,
      "",
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${baseName}_reviewed.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);

    const escalated = exportCases.filter(
      (fraudCase) => statuses[fraudCase.transaction_id] === "escalated_fraud",
    ).length;
    addToast(
      `Exported ${number.format(exportCases.length)} transactions (${escalated} marked as fraud) with scores, reasons, and review decisions.`,
      "success",
    );
  };

  const moveBy = (offset: number) => {
    setActiveIndex((index) => {
      if (filteredCases.length === 0) {
        return 0;
      }
      const currentIndex = Math.min(index, filteredCases.length - 1);
      return Math.min(
        Math.max(currentIndex + offset, 0),
        filteredCases.length - 1,
      );
    });
  };

  const goNext = () => moveBy(1);
  const goPrevious = () => moveBy(-1);

  const handleReviewAction = (
    nextStatus: Exclude<ReviewStatus, "unreviewed">,
  ) => {
    if (!currentCase) {
      return;
    }

    const previousStatus = statuses[currentCase.transaction_id];
    const action = actionLabels[nextStatus];
    const auditId = Date.now() + Math.random();
    const nextStatuses = {
      ...statuses,
      [currentCase.transaction_id]: nextStatus,
    };
    const newAuditEntry: AuditEntry = {
      id: auditId,
      time: new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      }),
      transactionId: currentCase.transaction_id,
      action: action.audit,
      previousStatus,
      newStatus: nextStatus,
      fraudScore: currentCase.fraud_score,
      severity: currentCase.severity,
      reasons: currentCase.reasons.slice(0, 3),
    };

    const nextCasesWithStatuses = withStatuses(flaggedCases, nextStatuses);
    const nextCases = filterCases(
      sortCasesByRisk(
        nextCasesWithStatuses,
        getSuppressedPatterns(nextCasesWithStatuses),
      ),
      filters,
      searchTerm,
    );
    const currentPosition = safeActiveIndex;
    const stillVisible = nextCases.some(
      (fraudCase) => fraudCase.transaction_id === currentCase.transaction_id,
    );
    const nextPosition =
      nextCases.length === 0
        ? 0
        : Math.min(
          stillVisible ? currentPosition + 1 : currentPosition,
          nextCases.length - 1,
        );

    setStatuses(nextStatuses);
    setAuditEntries((current) => [newAuditEntry, ...current]);
    setLastAction({
      caseId: currentCase.transaction_id,
      previousStatus,
      newStatus: nextStatus,
      auditId,
      actionLabel: action.audit,
    });
    setActiveIndex(nextPosition);
    addToast(
      `${currentCase.transaction_id} ${action.toast}. Press U to undo.`,
      nextStatus === "escalated_fraud" ? "warning" : "success",
    );

    // Feedback loop: if this dismissal just crossed the suppression threshold for
    // one of its patterns, tell the reviewer how many similar flags were de-prioritized.
    if (nextStatus === "dismissed_flag") {
      const before = getSuppressedPatterns(casesWithStatuses);
      const after = getSuppressedPatterns(nextCasesWithStatuses);
      const newlyLearned = currentCase.detected_patterns.find(
        (pattern) => after.has(pattern) && !before.has(pattern),
      );
      if (newlyLearned) {
        const deprioritized = nextCasesWithStatuses.filter(
          (fraudCase) =>
            fraudCase.review_status === "unreviewed" &&
            fraudCase.detected_patterns.includes(newlyLearned),
        ).length;
        if (deprioritized > 0) {
          addToast(
            `Learned: "${formatPattern(newlyLearned)}" dismissed repeatedly — ${deprioritized} similar flag${
              deprioritized === 1 ? "" : "s"
            } de-prioritized in the queue.`,
            "info",
          );
        }
      }
    }

    const allReviewed = flaggedCases.every(
      (fraudCase) =>
        nextStatuses[fraudCase.transaction_id] !== "unreviewed",
    );
    if (allReviewed) {
      setView("complete");
    }
  };

  const handleUndo = () => {
    if (!lastAction) {
      addToast("No review action to undo.", "info");
      return;
    }

    const nextStatuses = {
      ...statuses,
      [lastAction.caseId]: lastAction.previousStatus,
    };
    const restoredCasesWithStatuses = withStatuses(flaggedCases, nextStatuses);
    const nextCases = filterCases(
      sortCasesByRisk(
        restoredCasesWithStatuses,
        getSuppressedPatterns(restoredCasesWithStatuses),
      ),
      filters,
      searchTerm,
    );
    const restoredIndex = Math.max(
      0,
      nextCases.findIndex(
        (fraudCase) => fraudCase.transaction_id === lastAction.caseId,
      ),
    );

    setStatuses(nextStatuses);
    setAuditEntries((current) =>
      current.filter((entry) => entry.id !== lastAction.auditId),
    );
    setLastAction(null);
    setView("review");
    setActiveIndex(restoredIndex);
    addToast(`${lastAction.actionLabel} undone for ${lastAction.caseId}.`, "info");
  };

  const handleSensitivityChange = (mode: SensitivityMode) => {
    setSensitivity(mode);
    setActiveIndex(0);
    addToast(
      getSensitivitySummary(
        mode,
        getFlaggedCases(allScoredCases, mode).length,
        datasetSummary.totalTransactions,
      ),
      "info",
    );
  };

  const handleSwipeAction = (
    caseId: string,
    nextStatus: Exclude<ReviewStatus, "unreviewed">,
  ) => {
    const fraudCase = casesWithStatuses.find((c) => c.transaction_id === caseId);
    if (!fraudCase) return;
    const action = actionLabels[nextStatus];
    const auditId = Date.now() + Math.random();
    const previousStatus = statuses[caseId];
    setStatuses((prev) => ({ ...prev, [caseId]: nextStatus }));
    setAuditEntries((prev) => [
      {
        id: auditId,
        time: new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
        transactionId: caseId,
        action: action.audit,
        previousStatus,
        newStatus: nextStatus,
        fraudScore: fraudCase.fraud_score,
        severity: fraudCase.severity,
        reasons: fraudCase.reasons.slice(0, 3),
      },
      ...prev,
    ]);
    setLastAction({ caseId, previousStatus, newStatus: nextStatus, auditId, actionLabel: action.audit });
    setSwipeStats((prev) => ({
      approved: prev.approved + (nextStatus === "approved_legitimate" ? 1 : 0),
      escalated: prev.escalated + (nextStatus === "escalated_fraud" ? 1 : 0),
      review: prev.review + (nextStatus === "dismissed_flag" ? 1 : 0),
    }));
    addToast(`${caseId} ${action.toast}.`, nextStatus === "escalated_fraud" ? "warning" : "success");
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;

      if (isTyping) {
        return;
      }

      if (event.key === "/") {
        event.preventDefault();
        setView("review");
        window.setTimeout(() => searchInputRef.current?.focus(), 0);
        return;
      }

      if (view !== "review" && view !== "complete") {
        return;
      }

      const key = event.key.toLowerCase();
      if (key === "u") {
        event.preventDefault();
        handleUndo();
        return;
      }

      if (view !== "review") {
        return;
      }

      if (key === "a") {
        event.preventDefault();
        handleReviewAction("approved_legitimate");
      } else if (key === "d") {
        event.preventDefault();
        handleReviewAction("dismissed_flag");
      } else if (key === "e") {
        event.preventDefault();
        handleReviewAction("escalated_fraud");
      } else if (key === "n" || event.key === "ArrowRight") {
        event.preventDefault();
        goNext();
      } else if (key === "p" || event.key === "ArrowLeft") {
        event.preventDefault();
        goPrevious();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  });

  const unreviewedCount = casesWithStatuses.filter(
    (fraudCase) => fraudCase.review_status === "unreviewed",
  ).length;

  const unreviewedCases = useMemo(
    () => casesWithStatuses.filter((c) => c.review_status === "unreviewed"),
    [casesWithStatuses],
  );

  const exitVariants = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, scale: 0.97, filter: "blur(3px)" };

  const enterVariants = prefersReducedMotion
    ? { opacity: 0 }
    : { opacity: 0, y: 20 };

  const transitionOut = { duration: prefersReducedMotion ? 0 : 0.26, ease: [0.4, 0, 1, 1] as const };
  const transitionIn = { duration: prefersReducedMotion ? 0 : 0.38, ease: [0, 0, 0.2, 1] as const, delay: prefersReducedMotion ? 0 : 0.06 };

  return (
    <div className="min-h-screen bg-[#f2f7f3] text-zinc-950">
      <AnimatePresence mode="wait" initial={false}>
        {view === "upload" ? (
          <motion.div
            key="upload"
            animate={{ opacity: 1, scale: 1, filter: "blur(0px)", y: 0 }}
            exit={exitVariants}
            transition={transitionOut}
          >
            <UploadScreen
              isPythonScored={isPythonScored}
              onFileSelected={handleFileSelected}
              onProcess={handleProcessTransactions}
              processing={processing}
              processingStep={processingStep}
              selectedFileName={selectedFileName}
              sourceRows={sourceRows}
              uploadError={uploadError}
              uploadWarnings={uploadWarnings}
            />
          </motion.div>
        ) : (
          <motion.div
            key="app"
            className="flex min-h-screen"
            initial={enterVariants}
            animate={{ opacity: 1, y: 0 }}
            transition={transitionIn}
          >
            <Sidebar
              view={view}
              unreviewedCount={unreviewedCount}
              onGoDashboard={() => setView("dashboard")}
              onGoReview={() => setView("review")}
              onGoAudit={() => setView("audit")}
              onGoUpload={() => setView("upload")}
              onGoSwipe={() => {
                setSwipeStats({ approved: 0, escalated: 0, review: 0 });
                setView("swipe");
              }}
            />
            <div className="flex min-w-0 flex-1 flex-col">
              {view === "dashboard" && (
                <Dashboard
                  auditEntries={auditEntries}
                  cases={casesWithStatuses}
                  datasetSummary={datasetSummary}
                  escalatedCount={escalatedCount}
                  allScoredCases={allScoredCases}
                  onExport={handleExport}
                  onOpenAudit={() => setView("audit")}
                  onOpenReview={() => setView("review")}
                  projectedFlaggedCount={projectedFlaggedCount}
                  reviewedCount={reviewedCount}
                  reviewProgress={reviewProgress}
                  sensitivity={sensitivity}
                  onSensitivityChange={handleSensitivityChange}
                  totalTransactions={datasetSummary.totalTransactions}
                />
              )}

              {view === "review" && (
                <ReviewQueue
                  activeIndex={safeActiveIndex}
                  activeTab={activeTab}
                  cases={casesWithStatuses}
                  currentCase={currentCase}
                  filteredCases={filteredCases}
                  filters={filters}
                  lastAction={lastAction}
                  onAction={handleReviewAction}
                  onClearFilters={() => {
                    setFilters(defaultFilters);
                    setSearchTerm("");
                  }}
                  onExport={handleExport}
                  onGoAudit={() => setView("audit")}
                  onGoDashboard={() => setView("dashboard")}
                  onNext={goNext}
                  onPrevious={goPrevious}
                  onSearch={(value) => {
                    setActiveIndex(0);
                    setSearchTerm(value);
                  }}
                  onSensitivityChange={handleSensitivityChange}
                  onTabChange={setActiveTab}
                  onUndo={handleUndo}
                  reviewProgress={reviewProgress}
                  reviewedCount={reviewedCount}
                  searchInputRef={searchInputRef}
                  searchTerm={searchTerm}
                  sensitivity={sensitivity}
                  setFilters={(nextFilters) => {
                    setActiveIndex(0);
                    setFilters(nextFilters);
                  }}
                  suppressedCount={suppressedCount}
                  suppressedPatterns={suppressedPatterns}
                />
              )}

              {view === "audit" && (
                <AuditLog
                  entries={auditEntries}
                  onBackToReview={() => setView("review")}
                  onExport={handleExport}
                  onGoDashboard={() => setView("dashboard")}
                />
              )}

              {view === "complete" && (
                <CompletionState
                  auditEntries={auditEntries}
                  casesWithStatuses={casesWithStatuses}
                  datasetSummary={datasetSummary}
                  onExport={handleExport}
                  onGoAudit={() => setView("audit")}
                  onReviewAgain={() => setView("review")}
                  onUndo={handleUndo}
                  totalTransactions={datasetSummary.totalTransactions}
                />
              )}

              {view === "swipe" && (
                <main className="w-full">
                  <div className="border-b border-zinc-200 bg-white px-5 py-4 sm:px-8">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h1 className="text-lg font-semibold text-zinc-950">Quick Review</h1>
                        <p className="mt-1 text-sm text-zinc-500">
                          Use quick review for obvious cases. Switch to Review Queue for uncertain cases requiring full details.
                        </p>
                        <p className="mt-1 text-xs text-zinc-400">
                          Swipe right to approve · left to escalate · down to defer
                        </p>
                      </div>
                      <span className="shrink-0 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-semibold text-emerald-800">
                        {unreviewedCases.length} remaining
                      </span>
                    </div>
                  </div>
                  <FraudSwipeStack
                    cases={unreviewedCases}
                    onApprove={(id) => handleSwipeAction(id, "approved_legitimate")}
                    onFraud={(id) => handleSwipeAction(id, "escalated_fraud")}
                    onReview={(id) => handleSwipeAction(id, "dismissed_flag")}
                    onComplete={() => setView("complete")}
                    totalCasesInQueue={casesWithStatuses.length}
                    startIndexOffset={reviewedCount}
                    sessionStats={swipeStats}
                  />
                </main>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <Toast messages={toasts} />
    </div>
  );
}

function UploadScreen({
  isPythonScored,
  onFileSelected,
  onProcess,
  processing,
  processingStep,
  selectedFileName,
  sourceRows,
  uploadError,
  uploadWarnings,
}: {
  isPythonScored: boolean;
  onFileSelected: (file: File | null) => void;
  onProcess: () => void;
  processing: boolean;
  processingStep: number;
  selectedFileName: string;
  sourceRows: ScoredTransactionCsvRow[];
  uploadError: string | null;
  uploadWarnings: string[];
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const loadedCards = new Set(sourceRows.map((row) => row.card_id)).size;
  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    onFileSelected(event.target.files?.[0] ?? null);
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    onFileSelected(event.dataTransfer.files?.[0] ?? null);
  };

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden bg-black text-white px-5 py-16">
      {/* ── Aura animated background ───────────────────────────────── */}
      <AuraBackground />

      {/* ── HERO: centered title + description ──────────────────────── */}
      <div className="relative z-10 w-full max-w-xl text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-400">
          <ShieldCheck className="h-4 w-4" />
          The reviewer keeps the final say
        </div>

        <h1 className="mt-14">
          <GooeyText
            texts={["FraudFrog", "Detect Fraud", "Flag Threats", "Protect the Pool", "FraudFrog"]}
            morphTime={1.2}
            cooldownTime={2.5}
            className="h-20"
            textClassName="text-6xl sm:text-7xl font-bold tracking-tight text-white"
          />
        </h1>

        <p className="mt-5 text-lg leading-7 text-gray-400">
          Upload a transactions CSV to detect suspicious cases. FraudFrog scores
          each transaction and presents flagged cases one by one for your team
          to approve, escalate, or defer.
        </p>
      </div>

      {/* ── UPLOAD ZONE ─────────────────────────────────────────────── */}
      <div className="relative z-10 mt-10 w-full max-w-xl">
        <div
          className="relative overflow-hidden rounded-3xl border border-white/10 bg-[#0A0A0C] p-10 text-center shadow-2xl backdrop-blur-sm transition-colors duration-200 hover:border-white/20"
          onDragOver={(event) => event.preventDefault()}
          onDrop={handleDrop}
        >
          {/* Radial gradient overlay */}
          <div className="pointer-events-none absolute inset-0 rounded-3xl bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-[#1a1a2e] via-[#0A0A0C] to-[#0A0A0C]" />
          {/* Dot texture */}
          <div
            className="pointer-events-none absolute inset-0 rounded-3xl opacity-20"
            style={{
              backgroundImage: "radial-gradient(white 1px, transparent 1px)",
              backgroundSize: "40px 40px",
              maskImage: "radial-gradient(circle, black 40%, transparent 100%)",
              WebkitMaskImage: "radial-gradient(circle, black 40%, transparent 100%)",
            }}
          />
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Upload className="h-8 w-8 text-blue-400" />
          </div>
          <p className="mt-4 text-sm font-medium text-gray-500">
            Drag and drop your file here, or
          </p>
          <input
            accept=".csv,.tsv,text/csv,text/tab-separated-values"
            className="sr-only"
            onChange={handleInputChange}
            ref={fileInputRef}
            type="file"
          />
          <button
            className="mx-auto mt-4 flex min-h-12 w-full items-center justify-between rounded-xl border border-blue-500/40 bg-black/60 px-4 py-3 text-left transition-all duration-200 shadow-[0_0_20px_rgba(59,130,246,0.15),inset_0_0_10px_rgba(59,130,246,0.05)] hover:bg-blue-500/10 hover:border-blue-400/60 hover:shadow-[0_0_35px_rgba(59,130,246,0.25),inset_0_0_20px_rgba(59,130,246,0.1)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
            onClick={() => fileInputRef.current?.click()}
            type="button"
          >
            <div className="flex items-center gap-3">
              <FileText className="h-5 w-5 text-gray-400" />
              <span className="text-sm font-semibold text-gray-200">
                {selectedFileName || "Upload .csv transactions file"}
              </span>
            </div>
            <span className={`text-xs font-bold ${sourceRows.length > 0 ? "text-emerald-400" : "text-gray-500"}`}>
              {sourceRows.length > 0 ? "Loaded" : "Browse"}
            </span>
          </button>
        </div>

        {/* Error */}
        {uploadError && (
          <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm font-semibold text-red-400">
            {uploadError}
          </div>
        )}

        {/* Success summary */}
        {sourceRows.length > 0 && !uploadError && (
          <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-emerald-400">
              {number.format(sourceRows.length)} transactions · {number.format(loadedCards)} cards loaded from {selectedFileName}.
            </p>
            <p className="mt-1 text-sm text-emerald-500/80">
              {isPythonScored
                ? "Python fraud scores detected — scores will be used directly."
                : "Mock scoring will be applied; flagged cases sent to review."}
            </p>
          </div>
        )}

        {/* Warnings */}
        {uploadWarnings.length > 0 && (
          <div className="mt-4 rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3">
            <p className="text-sm font-semibold text-amber-400">Rows skipped</p>
            <ul className="mt-1.5 space-y-1 text-sm text-amber-500/80">
              {uploadWarnings.slice(0, 4).map((warning) => (
                <li key={warning}>{warning}</li>
              ))}
            </ul>
          </div>
        )}

        {/* Processing */}
        {processing && (
          <LoadingState
            currentStep={processingStep}
            steps={processingSteps}
            title="Preparing review queue"
          />
        )}

        {/* Process CTA */}
        <button
          className="mt-5 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-white px-5 py-3.5 text-base font-semibold text-black shadow-sm transition-colors duration-200 hover:bg-gray-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          disabled={processing || sourceRows.length === 0}
          onClick={onProcess}
          type="button"
        >
          {processing ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            <Database className="h-5 w-5" />
          )}
          {processing ? "Analysing…" : "Analyse Transactions"}
        </button>

        {/* Expected columns */}
        <details className="mt-5 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-gray-500 hover:text-gray-300">
            Expected CSV columns ({csvInputFields.length})
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {csvInputFields.map((field) => (
              <span
                className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-xs font-semibold text-gray-400"
                key={field}
              >
                {field}
              </span>
            ))}
          </div>
        </details>
      </div>
    </main>
  );
}

function Dashboard({
  auditEntries,
  allScoredCases,
  cases,
  datasetSummary,
  escalatedCount,
  onExport,
  onOpenAudit,
  onOpenReview,
  projectedFlaggedCount,
  reviewedCount,
  reviewProgress,
  sensitivity,
  onSensitivityChange,
  totalTransactions,
}: {
  auditEntries: AuditEntry[];
  allScoredCases: FraudCase[];
  cases: FraudCase[];
  datasetSummary: DatasetSummary;
  escalatedCount: number;
  onExport: () => void;
  onOpenAudit: () => void;
  onOpenReview: () => void;
  projectedFlaggedCount: number;
  reviewedCount: number;
  reviewProgress: number;
  sensitivity: SensitivityMode;
  onSensitivityChange: (mode: SensitivityMode) => void;
  totalTransactions: number;
}) {
  const severityDistribution = countBy(cases, "severity");
  const highOrCriticalCount = cases.filter(
    (fraudCase) =>
      fraudCase.severity === "High" || fraudCase.severity === "Critical",
  ).length;

  const categoryColors = ["#0ea5e9", "#8b5cf6", "#f59e0b", "#10b981", "#ef4444", "#06b6d4", "#f97316"];
  const categoryData = Object.entries(countBy(allScoredCases, "merchant_category"))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 7)
    .map(([label, value], i) => ({
      label: titleCase(label),
      value,
      color: categoryColors[i % categoryColors.length]!,
    }));

  const fraudData = [
    { label: "Flagged", value: projectedFlaggedCount, color: "#ef4444" },
    { label: "Clean", value: Math.max(0, totalTransactions - projectedFlaggedCount), color: "#10b981" },
  ];

  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-5 py-6 sm:px-8">
      <AppHeader
        action={
          <div className="flex flex-wrap gap-2">
            <ExportButton onExport={onExport} />
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={onOpenAudit}
              type="button"
            >
              <History className="h-4 w-4" />
              View Audit Log
            </button>
          </div>
        }
        hideBrand
        mode="Dashboard overview"
      />

      <section className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            Analysis ready
          </div>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-zinc-950">
            {projectedFlaggedCount} cases need review
          </h1>
          <p className="mt-1.5 max-w-xl text-sm leading-6 text-zinc-500">
            {number.format(totalTransactions)} transactions from {datasetSummary.fileName} · the detector finds signals, the reviewer makes the final call.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            onClick={onOpenReview}
            type="button"
          >
            <ShieldAlert className="h-4 w-4" />
            Start Review
          </button>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-5 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={onOpenReview}
            type="button"
          >
            <ListChecks className="h-4 w-4" />
            Open Review Queue
          </button>
        </div>
      </section>

      <section className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Database}
          label="Total transactions"
          value={number.format(datasetSummary.totalTransactions)}
        />
        <MetricCard
          icon={ShieldAlert}
          label="Cases needing review"
          value={number.format(projectedFlaggedCount)}
        />
        <MetricCard
          icon={AlertTriangle}
          label="High-priority cases"
          value={number.format(highOrCriticalCount)}
        />
        <MetricCard
          icon={Gauge}
          label="Progress"
          value={`${reviewProgress}%`}
        />
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-2">
        <PieChart
          data={categoryData}
          title="Transaction categories"
          subtitle="Merchant category breakdown across all uploaded transactions."
        />
        <PieChart
          data={fraudData}
          title="Flagged vs unflagged"
          subtitle={`${projectedFlaggedCount} flagged out of ${number.format(totalTransactions)} transactions at ${sensitivity} sensitivity.`}
        />
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <DistributionPanel
          data={severityDistribution}
          title="Priority mix"
        />

        <SensitivityControl
          sensitivity={sensitivity}
          onChange={onSensitivityChange}
          flaggedCount={projectedFlaggedCount}
          totalTransactions={datasetSummary.totalTransactions}
        />
      </section>

      <section className="mt-5 grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-semibold text-zinc-950">
                Signals to Investigate
              </h2>
              <p className="mt-1 text-sm text-zinc-500">
                Highest-signal patterns from the current upload.
              </p>
            </div>
            <BarChart3 className="h-5 w-5 text-zinc-500" />
          </div>
          <div className="mt-5 grid gap-3 md:grid-cols-3">
            {buildTopIssues(allScoredCases).slice(0, 3).map(([label, value, meta]) => (
              <div
                key={label}
                className="rounded-lg bg-zinc-50 p-4"
              >
                <div className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
                  {label}
                </div>
                <div className="mt-2 text-base font-semibold text-zinc-950">
                  {value}
                </div>
                <div className="mt-1 text-sm text-zinc-600">{meta}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-zinc-500 uppercase tracking-wide">Session</h2>
          <div className="mt-3 space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600">Reviewed</span>
              <span className="font-semibold text-zinc-950">{reviewedCount} / {cases.length}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600">Escalated</span>
              <span className="font-semibold text-red-700">{escalatedCount}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-zinc-600">Audit entries</span>
              <span className="font-semibold text-zinc-950">{auditEntries.length}</span>
            </div>
          </div>
          {auditEntries.length === 0 && (
            <p className="mt-3 text-xs text-zinc-400">No review actions yet.</p>
          )}
          <button
            className="mt-5 inline-flex min-h-10 w-full items-center justify-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-700 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            onClick={onOpenAudit}
            type="button"
          >
            <History className="h-4 w-4" />
            View Audit Log
          </button>
        </div>
      </section>
    </main>
  );
}

function ReviewQueue({
  activeIndex,
  activeTab,
  cases,
  currentCase,
  filteredCases,
  filters,
  lastAction,
  onAction,
  onClearFilters,
  onExport,
  onGoAudit,
  onGoDashboard,
  onNext,
  onPrevious,
  onSearch,
  onSensitivityChange,
  onTabChange,
  onUndo,
  reviewProgress,
  reviewedCount,
  searchInputRef,
  searchTerm,
  sensitivity,
  setFilters,
  suppressedCount,
  suppressedPatterns,
}: {
  activeIndex: number;
  activeTab: DetailTab;
  cases: FraudCase[];
  currentCase: FraudCase | null;
  filteredCases: FraudCase[];
  filters: FiltersState;
  lastAction: LastAction | null;
  onAction: (status: Exclude<ReviewStatus, "unreviewed">) => void;
  onClearFilters: () => void;
  onExport: () => void;
  onGoAudit: () => void;
  onGoDashboard: () => void;
  onNext: () => void;
  onPrevious: () => void;
  onSearch: (value: string) => void;
  onSensitivityChange: (mode: SensitivityMode) => void;
  onTabChange: (tab: DetailTab) => void;
  onUndo: () => void;
  reviewProgress: number;
  reviewedCount: number;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchTerm: string;
  sensitivity: SensitivityMode;
  setFilters: Dispatch<SetStateAction<FiltersState>>;
  suppressedCount: number;
  suppressedPatterns: Set<string>;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-[1500px] px-4 py-5 sm:px-6">
      <AppHeader
        action={
          <div className="flex flex-wrap items-center gap-2">
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={onGoDashboard}
              type="button"
            >
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </button>
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={onGoAudit}
              type="button"
            >
              <History className="h-4 w-4" />
              Audit
            </button>
            <ExportButton onExport={onExport} />
          </div>
        }
        hideBrand
        mode="Review Queue"
      />

      <div className="mt-4 rounded-xl border border-zinc-200 bg-white px-5 py-3.5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="rounded-full bg-emerald-600 px-3 py-1 text-sm font-bold text-white">
              Case {filteredCases.length > 0 ? activeIndex + 1 : 0} of {filteredCases.length}
            </span>
            <span className="text-sm text-zinc-500">
              {reviewedCount} reviewed · {cases.length - reviewedCount} remaining
            </span>
          </div>
          <div className="flex items-center gap-2.5">
            <div className="h-1.5 w-28 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all duration-300"
                style={{ width: `${reviewProgress}%` }}
              />
            </div>
            <span className="text-xs font-semibold tabular-nums text-zinc-500">{reviewProgress}%</span>
          </div>
        </div>
      </div>

      {suppressedCount > 0 && (
        <div className="mt-3 flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <p className="text-sm text-emerald-900">
              <span className="font-semibold">Learning from your decisions:</span>{" "}
              you repeatedly dismissed{" "}
              {[...suppressedPatterns].map(formatPattern).join(", ")}. {suppressedCount}{" "}
              similar unreviewed flag{suppressedCount === 1 ? "" : "s"} moved to the
              bottom of the queue.
            </p>
          </div>
        </div>
      )}

      <section className="mt-3">
        <SearchFilters
          cases={cases}
          filters={filters}
          onClearFilters={onClearFilters}
          onSearch={onSearch}
          searchInputRef={searchInputRef}
          searchTerm={searchTerm}
          setFilters={setFilters}
        />
        <div className="mt-2 flex flex-wrap items-center justify-between gap-2 px-0.5">
          <KeyboardShortcutHelp />
          <div className="flex items-center gap-1.5">
            <SlidersHorizontal className="h-3.5 w-3.5 text-zinc-400" />
            {(["Conservative", "Balanced", "Aggressive"] as SensitivityMode[]).map(
              (mode) => (
                <button
                  className={`min-h-7 cursor-pointer rounded px-2.5 text-xs font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${sensitivity === mode
                      ? "bg-emerald-600 text-white"
                      : "border border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                    }`}
                  key={mode}
                  onClick={() => onSensitivityChange(mode)}
                  type="button"
                >
                  {mode}
                </button>
              ),
            )}
          </div>
        </div>
      </section>

      <section className="mt-4 grid gap-4 xl:grid-cols-[minmax(0,1fr)_390px]">
        <section>
          {currentCase ? (
            <TransactionReviewCard
              caseNumber={activeIndex + 1}
              fraudCase={currentCase}
              lastAction={lastAction}
              matchingCount={filteredCases.length}
              onAction={onAction}
              onNext={onNext}
              onPrevious={onPrevious}
              onUndo={onUndo}
            />
          ) : (
            <EmptyState
              actionLabel="Clear filters"
              icon={Filter}
              onAction={onClearFilters}
              title="No cases match these filters."
              description="Clear filters or adjust sensitivity."
            />
          )}
        </section>

        <aside>
          {currentCase ? (
            <EvidencePanel
              activeTab={activeTab}
              fraudCase={currentCase}
              onTabChange={onTabChange}
            />
          ) : (
            <EmptyState
              icon={Search}
              title="No evidence selected."
              description="Select a matching case to inspect baseline, related activity, timeline, and summary."
            />
          )}
        </aside>
      </section>
    </main>
  );
}

function TransactionReviewCard({
  caseNumber,
  fraudCase,
  lastAction,
  matchingCount,
  onAction,
  onNext,
  onPrevious,
  onUndo,
}: {
  caseNumber: number;
  fraudCase: FraudCase;
  lastAction: LastAction | null;
  matchingCount: number;
  onAction: (status: Exclude<ReviewStatus, "unreviewed">) => void;
  onNext: () => void;
  onPrevious: () => void;
  onUndo: () => void;
}) {
  const patternTitle = fraudCase.detected_patterns
    .slice(0, 2)
    .map(formatPattern)
    .join(" + ");

  return (
    <article className="overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-100 bg-zinc-50/60 p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <SeverityBadge severity={fraudCase.severity} />
              <span
                className={`rounded-full border px-3 py-1 text-sm font-semibold ${statusTone[fraudCase.review_status]}`}
              >
                {statusLabels[fraudCase.review_status]}
              </span>
            </div>
            <h2 className="mt-3 text-3xl font-bold tracking-tight text-zinc-950">
              {fraudCase.fraud_score}
              <span className="text-lg font-medium text-zinc-400">/100</span>
              <span className="ml-3 text-xl font-semibold text-zinc-600">{fraudCase.severity} Risk</span>
            </h2>
            <p className="mt-1.5 text-sm font-medium text-zinc-500">
              {patternTitle}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <span className="text-xs font-medium text-zinc-400">
              Case {caseNumber} of {matchingCount}
            </span>
          </div>
        </div>
      </div>

      <div className="p-5">
        <div className="flex flex-wrap gap-2">
          {fraudCase.detected_patterns.slice(0, 3).map((pattern) => (
            <PatternBadge key={pattern} pattern={pattern} />
          ))}
        </div>

        <div className="mt-5 grid gap-4 rounded-xl bg-zinc-50 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <Fact label="Transaction ID" value={fraudCase.transaction_id} />
          <Fact label="Amount" value={money.format(fraudCase.amount)} strong />
          <Fact label="Merchant" value={fraudCase.merchant_name} />
          <Fact label="Card ID" value={fraudCase.card_id} />
        </div>

        <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <AlertTriangle className="h-4 w-4" />
              Why flagged
            </div>
            <span className="text-xs text-amber-700/70">Signals — reviewer makes the final call</span>
          </div>
          <ol className="mt-3 space-y-2.5">
            {fraudCase.reasons.slice(0, 3).map((reason, i) => (
              <li key={reason} className="flex items-start gap-2.5">
                <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-300 text-[10px] font-bold text-amber-950">
                  {i + 1}
                </span>
                <span className="text-sm leading-5 text-amber-950">{reason}</span>
              </li>
            ))}
          </ol>
        </div>

        <details className="mt-4 rounded-xl border border-zinc-200 bg-white p-4">
          <summary className="cursor-pointer text-sm font-semibold text-zinc-800">
            Transaction details
          </summary>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            <Fact
              label="Category"
              value={titleCase(fraudCase.merchant_category)}
            />
            <Fact label="Channel" value={formatChannel(fraudCase.channel)} />
            <Fact label="Timestamp" value={formatShortDate(fraudCase.timestamp)} />
            <Fact label="Cardholder country" value={fraudCase.cardholder_country} />
            <Fact label="Merchant country" value={fraudCase.merchant_country} />
            {fraudCase.device_id && (
              <Fact label="Device ID" value={fraudCase.device_id} />
            )}
            {fraudCase.ip_address && (
              <Fact label="IP address" value={fraudCase.ip_address} />
            )}
          </div>
        </details>

        <div className="mt-5 grid gap-3 lg:grid-cols-3">
          <ReviewActionButton
            icon={BadgeCheck}
            label="Approve Legitimate"
            shortcut="A"
            tone="approve"
            onClick={() => onAction("approved_legitimate")}
          />
          <ReviewActionButton
            icon={Ban}
            label="Dismiss Flag"
            shortcut="D"
            tone="dismiss"
            onClick={() => onAction("dismissed_flag")}
          />
          <ReviewActionButton
            icon={ShieldAlert}
            label="Escalate Fraud"
            shortcut="E"
            tone="escalate"
            onClick={() => onAction("escalated_fraud")}
          />
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-zinc-200 pt-4">
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={onPrevious}
              type="button"
            >
              <ArrowLeft className="h-4 w-4" />
              Previous
            </button>
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={onNext}
              type="button"
            >
              Next
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950 disabled:cursor-not-allowed disabled:text-zinc-400"
            disabled={!lastAction}
            onClick={onUndo}
            type="button"
          >
            <RotateCcw className="h-4 w-4" />
            Undo (U)
          </button>
        </div>
      </div>
    </article>
  );
}

function EvidencePanel({
  activeTab,
  fraudCase,
  onTabChange,
}: {
  activeTab: DetailTab;
  fraudCase: FraudCase;
  onTabChange: (tab: DetailTab) => void;
}) {
  const tabs: DetailTab[] = ["Baseline", "Related", "Timeline", "AI Summary"];

  return (
    <section className="rounded-lg border border-zinc-200 bg-white shadow-sm">
      <div className="border-b border-zinc-200 p-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-2">
          {tabs.map((tab) => (
            <button
              className={`min-h-10 rounded-md px-3 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${activeTab === tab
                  ? "bg-emerald-600 text-white"
                  : "bg-zinc-50 text-zinc-600 hover:bg-emerald-50 hover:text-zinc-900"
                }`}
              key={tab}
              onClick={() => onTabChange(tab)}
              type="button"
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      <div className="p-4">
        {activeTab === "Baseline" && <BaselineSnapshot fraudCase={fraudCase} />}
        {activeTab === "Related" && (
          <RelatedActivityPanel fraudCase={fraudCase} />
        )}
        {activeTab === "Timeline" && <FraudTimeline fraudCase={fraudCase} />}
        {activeTab === "AI Summary" && <AISummaryPanel fraudCase={fraudCase} />}
      </div>
    </section>
  );
}

function BaselineSnapshot({ fraudCase }: { fraudCase: FraudCase }) {
  const rows = [
    {
      normal: `Median spend: ${money.format(fraudCase.baseline.median_amount)}`,
      current: `Amount: ${money.format(fraudCase.amount)}`,
      badge: `${fraudCase.baseline.amount_ratio}x higher`,
    },
    {
      normal: `Common categories: ${fraudCase.baseline.common_categories.join(
        ", ",
      )}`,
      current: `Category: ${fraudCase.merchant_category}`,
      badge: fraudCase.baseline.common_categories.includes(
        fraudCase.merchant_category,
      )
        ? "Known"
        : "Unusual",
    },
    {
      normal: `Usual countries: ${fraudCase.baseline.usual_countries.join(
        ", ",
      )}`,
      current: `Merchant country: ${fraudCase.merchant_country}`,
      badge: fraudCase.baseline.usual_countries.includes(
        fraudCase.merchant_country,
      )
        ? "Known"
        : "Foreign",
    },
    {
      normal: `Known devices: ${fraudCase.baseline.known_devices_count}`,
      current: `Device: ${fraudCase.device_id ? "new" : "not provided"}`,
      badge: fraudCase.device_id ? "New" : "Missing",
    },
    {
      normal: `Known IPs: ${fraudCase.baseline.known_ips_count}`,
      current: `IP: ${fraudCase.ip_address ? "new" : "not provided"}`,
      badge: fraudCase.ip_address ? "New" : "Missing",
    },
    {
      normal: `Common channel: ${formatChannel(
        fraudCase.baseline.common_channel,
      )}`,
      current: `Channel: ${formatChannel(fraudCase.channel)}`,
      badge:
        fraudCase.baseline.common_channel === fraudCase.channel
          ? "Known"
          : "Unusual",
    },
  ];

  return (
    <div>
      <PanelTitle
        icon={Gauge}
        title="Baseline comparison"
        subtitle="Normal behavior for this card versus the current transaction."
      />
      <div className="mt-4 overflow-hidden rounded-lg border border-zinc-200">
        <div className="grid grid-cols-[1fr_1fr_94px] bg-zinc-50 px-3 py-2 text-xs font-semibold uppercase tracking-normal text-zinc-500">
          <span>Normal for this card</span>
          <span>This transaction</span>
          <span>Signal</span>
        </div>
        {rows.map((row) => (
          <div
            className="grid grid-cols-[1fr_1fr_94px] gap-2 border-t border-zinc-200 px-3 py-3 text-sm"
            key={`${row.normal}-${row.current}`}
          >
            <span className="text-zinc-600">{row.normal}</span>
            <span className="font-medium text-zinc-900">{row.current}</span>
            <span className="rounded-full border border-zinc-200 bg-white px-2 py-1 text-center text-xs font-semibold text-zinc-700">
              {row.badge}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function RelatedActivityPanel({ fraudCase }: { fraudCase: FraudCase }) {
  const grouped = fraudCase.related_activity.reduce<
    Record<string, FraudCase["related_activity"]>
  >((accumulator, activity) => {
    const group = relatedGroup(activity.reason);
    accumulator[group] = [...(accumulator[group] ?? []), activity];
    return accumulator;
  }, {});

  return (
    <div>
      <PanelTitle
        icon={ListChecks}
        title="Related activity"
        subtitle="Transactions connected by card, merchant, device, IP, or time window."
      />
      <div className="mt-4 space-y-4">
        {Object.entries(grouped).map(([group, items]) => (
          <section key={group}>
            <h3 className="text-sm font-semibold text-zinc-950">{group}</h3>
            <div className="mt-2 space-y-2">
              {items.map((item) => (
                <div
                  className="rounded-lg border border-zinc-200 bg-zinc-50 p-3"
                  key={item.transaction_id}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-zinc-950">
                      {item.transaction_id}
                    </span>
                    <span className="text-sm font-semibold text-zinc-800">
                      {money.format(item.amount)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-zinc-700">
                    {item.merchant_name} - {formatShortDate(item.timestamp)}
                  </p>
                  <p className="mt-2 text-xs font-medium text-zinc-500">
                    {item.card_id}
                  </p>
                  <p className="mt-2 text-sm leading-5 text-zinc-600">
                    Related because: {item.reason}
                  </p>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function FraudTimeline({ fraudCase }: { fraudCase: FraudCase }) {
  return (
    <div>
      <PanelTitle
        icon={Clock3}
        title="Chronological fraud story"
        subtitle="Events are ordered as the signals developed."
      />
      <ol className="mt-4 space-y-3">
        {fraudCase.timeline.map((event) => (
          <li className="relative pl-8" key={`${event.time}-${event.label}`}>
            <span
              className={`absolute left-0 top-1 flex h-4 w-4 items-center justify-center rounded-full border ${event.type === "normal"
                  ? "border-emerald-300 bg-emerald-50"
                  : event.type === "critical"
                    ? "border-red-300 bg-red-50"
                    : event.type === "review"
                      ? "border-sky-300 bg-sky-50"
                      : "border-amber-300 bg-amber-50"
                }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current text-zinc-700" />
            </span>
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold text-zinc-900">
                  {event.time}
                </span>
                <span className="text-sm font-semibold text-zinc-950">
                  {event.label}
                </span>
              </div>
              <p className="mt-1 text-sm leading-5 text-zinc-600">
                {event.description}
              </p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function AISummaryPanel({ fraudCase }: { fraudCase: FraudCase }) {
  const [generatedCaseId, setGeneratedCaseId] = useState<string | null>(null);
  const [copiedCaseId, setCopiedCaseId] = useState<string | null>(null);
  const summary = makeSummary(fraudCase);
  const generated = generatedCaseId === fraudCase.transaction_id;
  const copied = copiedCaseId === fraudCase.transaction_id;

  const handleCopy = async () => {
    if (!generated) {
      setGeneratedCaseId(fraudCase.transaction_id);
    }
    try {
      await navigator.clipboard.writeText(summary);
      setCopiedCaseId(fraudCase.transaction_id);
    } catch {
      setCopiedCaseId(null);
    }
  };

  return (
    <div>
      <PanelTitle
        icon={Sparkles}
        title="Reviewer summary"
        subtitle="Summarizes visible fraud signals only. Score is not changed."
      />
      <div className="mt-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
        {generated ? (
          <p className="text-sm leading-6 text-zinc-700">{summary}</p>
        ) : (
          <p className="text-sm leading-6 text-zinc-600">
            Generate a concise case narrative from the visible fraud signals.
          </p>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          onClick={() => setGeneratedCaseId(fraudCase.transaction_id)}
          type="button"
        >
          <Sparkles className="h-4 w-4" />
          Generate Summary
        </button>
        <button
          className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
          onClick={handleCopy}
          type="button"
        >
          <Clipboard className="h-4 w-4" />
          {copied ? "Copied" : "Copy Summary"}
        </button>
      </div>
    </div>
  );
}

function SearchFilters({
  cases,
  filters,
  onClearFilters,
  onSearch,
  searchInputRef,
  searchTerm,
  setFilters,
}: {
  cases: FraudCase[];
  filters: FiltersState;
  onClearFilters: () => void;
  onSearch: (value: string) => void;
  searchInputRef: RefObject<HTMLInputElement | null>;
  searchTerm: string;
  setFilters: Dispatch<SetStateAction<FiltersState>>;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filterButtonRef = useRef<HTMLButtonElement>(null);

  const patterns = unique(cases.flatMap((fraudCase) => fraudCase.detected_patterns));
  const categories = unique(cases.map((fraudCase) => fraudCase.merchant_category));

  const advancedActiveCount = [
    filters.pattern !== "All",
    filters.category !== "All",
    filters.channel !== "All",
  ].filter(Boolean).length;

  const hasAnyActive =
    advancedActiveCount > 0 ||
    filters.severity !== "All" ||
    filters.status !== "All" ||
    searchTerm.length > 0;

  const updateFilter = <Key extends keyof FiltersState>(
    key: Key,
    value: FiltersState[Key],
  ) => {
    setFilters((current) => ({ ...current, [key]: value }));
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isTyping =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable;
      if (isTyping) return;
      if (event.key.toLowerCase() === "f") {
        event.preventDefault();
        setFiltersOpen((open) => !open);
        filterButtonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div>
      {/* Compact single-row toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-400" />
          <input
            className="min-h-9 w-full rounded-md border border-zinc-200 bg-white py-2 pl-9 pr-3 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search transactions..."
            ref={searchInputRef}
            type="search"
            value={searchTerm}
          />
        </div>

        <select
          aria-label="Filter by severity"
          className="min-h-9 cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          onChange={(event) =>
            updateFilter("severity", event.target.value as FiltersState["severity"])
          }
          value={filters.severity}
        >
          {(["All", "Critical", "High", "Medium", "Low"] as const).map((opt) => (
            <option key={opt} value={opt}>
              {opt === "All" ? "Severity" : opt}
            </option>
          ))}
        </select>

        <select
          aria-label="Filter by status"
          className="min-h-9 cursor-pointer rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
          onChange={(event) =>
            updateFilter("status", event.target.value as FiltersState["status"])
          }
          value={filters.status}
        >
          {(["All", "unreviewed", "approved_legitimate", "dismissed_flag", "escalated_fraud"] as const).map(
            (opt) => (
              <option key={opt} value={opt}>
                {opt === "All" ? "Status" : statusLabels[opt]}
              </option>
            ),
          )}
        </select>

        <button
          aria-expanded={filtersOpen}
          className={`inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${filtersOpen || advancedActiveCount > 0
              ? "border-emerald-700 bg-emerald-600 text-white"
              : "border-zinc-200 bg-white text-zinc-700 hover:bg-zinc-50"
            }`}
          onClick={() => setFiltersOpen((open) => !open)}
          ref={filterButtonRef}
          title="Press F to toggle filters"
          type="button"
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {advancedActiveCount > 0 && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-xs font-semibold ${filtersOpen ? "bg-white/25 text-white" : "bg-emerald-700 text-white"
                }`}
            >
              {advancedActiveCount}
            </span>
          )}
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform duration-200 motion-reduce:transition-none ${filtersOpen ? "rotate-180" : ""
              }`}
          />
        </button>

        {hasAnyActive && (
          <button
            className="inline-flex min-h-9 cursor-pointer items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 text-sm font-medium text-zinc-600 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={onClearFilters}
            type="button"
          >
            <X className="h-3.5 w-3.5" />
            Clear
          </button>
        )}
      </div>

      {/* Progressive disclosure: advanced filters panel */}
      <div
        className={`grid transition-[grid-template-rows] duration-300 motion-reduce:duration-0 ${filtersOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
      >
        <div className="overflow-hidden">
          <div className="mt-3 grid gap-3 rounded-lg border border-zinc-200 bg-zinc-50/80 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <SelectControl
              label="Pattern"
              value={filters.pattern}
              onChange={(value) => updateFilter("pattern", value)}
              options={["All", ...patterns]}
              getLabel={(value) => (value === "All" ? "All patterns" : formatPattern(value))}
            />
            <SelectControl
              label="Merchant category"
              value={filters.category}
              onChange={(value) => updateFilter("category", value)}
              options={["All", ...categories]}
              getLabel={(value) => (value === "All" ? "All categories" : titleCase(value))}
            />
            <SelectControl
              label="Channel"
              value={filters.channel}
              onChange={(value) =>
                updateFilter("channel", value as FiltersState["channel"])
              }
              options={["All", "online", "in_person", "atm"]}
              getLabel={(value) => (value === "All" ? "All channels" : formatChannel(value))}
            />
            <div className="flex justify-end sm:col-span-2 lg:col-span-3">
              <button
                className="inline-flex min-h-9 cursor-pointer items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-medium text-zinc-700 hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
                onClick={() =>
                  setFilters((current) => ({
                    ...current,
                    pattern: "All",
                    category: "All",
                    channel: "All",
                  }))
                }
                type="button"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                Reset advanced filters
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

const sensitivityModeDescriptions: Record<SensitivityMode, string> = {
  Conservative: "False positives cost more · fewer flags",
  Balanced: "Costs weighed evenly",
  Aggressive: "Missed fraud costs more · more flags",
};

function SensitivityControl({
  compact = false,
  flaggedCount,
  sensitivity,
  onChange,
  totalTransactions,
}: {
  compact?: boolean;
  flaggedCount: number;
  sensitivity: SensitivityMode;
  onChange: (mode: SensitivityMode) => void;
  totalTransactions: number;
}) {
  const [showKnobs, setShowKnobs] = useState(false);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-zinc-950">
            Review Cost Tuning
          </h2>
          <p className="mt-1 text-sm text-zinc-500">
            Set the cost of a false positive vs. a missed fraud — the flagged set
            updates live.
          </p>
        </div>
        <button
          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-zinc-200 bg-white text-zinc-500 shadow-sm transition hover:bg-zinc-50 hover:text-zinc-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          onClick={() => setShowKnobs(true)}
          type="button"
          aria-label="Open detector controls"
          aria-expanded={showKnobs}
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>
      <div
        className={`mt-4 grid gap-2 ${compact ? "grid-cols-1" : "sm:grid-cols-3"}`}
      >
        {(["Conservative", "Balanced", "Aggressive"] as SensitivityMode[]).map(
          (mode) => (
            <button
              className={`rounded-lg border px-3 py-2.5 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${sensitivity === mode
                  ? "border-emerald-600 bg-emerald-600 text-white"
                  : "border-zinc-200 bg-white text-zinc-700 hover:border-zinc-300 hover:bg-zinc-50"
                }`}
              key={mode}
              onClick={() => onChange(mode)}
              type="button"
            >
              <span className="block text-sm font-semibold">{mode}</span>
              <span className={`mt-0.5 block text-xs ${sensitivity === mode ? "text-white/75" : "text-zinc-500"}`}>
                {sensitivityModeDescriptions[mode]}
              </span>
            </button>
          ),
        )}
      </div>
      <div className="mt-2 flex items-center justify-between text-[11px] font-medium text-zinc-400">
        <span>← Protect customers (FP costs more)</span>
        <span>Catch fraud (misses cost more) →</span>
      </div>
      <p className="mt-4 rounded-lg border border-zinc-100 bg-zinc-50 p-3 text-sm leading-6 text-zinc-600">
        {getSensitivitySummary(sensitivity, flaggedCount, totalTransactions)}
      </p>
      {showKnobs && typeof document !== "undefined"
        ? createPortal(
          <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-zinc-950/50 px-4 py-6 backdrop-blur-sm"
            onClick={() => setShowKnobs(false)}
          >
            <div
              className="w-full max-w-2xl rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl"
              onClick={(event) => event.stopPropagation()}
              role="dialog"
              aria-modal="true"
              aria-labelledby="detector-controls-title"
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h3
                    id="detector-controls-title"
                    className="text-sm font-semibold text-zinc-950"
                  >
                    Detector controls
                  </h3>
                  <p className="mt-1 text-xs leading-5 text-zinc-500">
                    These are the main rule inputs behind the fraud detector.
                  </p>
                </div>
                <button
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-950"
                  onClick={() => setShowKnobs(false)}
                  type="button"
                  aria-label="Close detector controls"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {detectorKnobs.map((knob) => (
                  <div key={knob.label} className="rounded-lg bg-zinc-50 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-medium text-zinc-950">
                        {knob.label}
                      </span>
                      <span className="rounded-full border border-zinc-200 bg-white px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-zinc-600">
                        {knob.value}
                      </span>
                    </div>
                    <p className="mt-2 text-sm leading-5 text-zinc-600">
                      {knob.description}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>,
          document.body,
        )
        : null}
    </section>
  );
}

function AuditLog({
  entries,
  onBackToReview,
  onExport,
  onGoDashboard,
}: {
  entries: AuditEntry[];
  onBackToReview: () => void;
  onExport: () => void;
  onGoDashboard: () => void;
}) {
  return (
    <main className="mx-auto min-h-screen w-full max-w-7xl px-5 py-6 sm:px-8">
      <AppHeader
        action={
          <div className="flex flex-wrap gap-2">
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
              onClick={onGoDashboard}
              type="button"
            >
              <BarChart3 className="h-4 w-4" />
              Dashboard
            </button>
            <button
              className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
              onClick={onBackToReview}
              type="button"
            >
              <ShieldAlert className="h-4 w-4" />
              Back to Review
            </button>
          </div>
        }
        hideBrand
        mode="Audit log"
      />

      <section className="mt-6 rounded-lg border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-3xl font-semibold tracking-normal text-zinc-950">
              Reviewer decisions
            </h1>
            <p className="mt-2 text-sm leading-6 text-zinc-600">
              Decisions include the previous status, new status, score,
              severity, and reasons visible at action time.
            </p>
          </div>
          <button
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
            onClick={onExport}
            type="button"
          >
            <Download className="h-4 w-4" />
            Export Audit Log
          </button>
        </div>

        {entries.length === 0 ? (
          <div className="mt-5">
            <EmptyState
              actionLabel="Back to Review"
              icon={History}
              onAction={onBackToReview}
              title="No reviewer decisions yet."
              description="Once a reviewer approves, dismisses, or escalates a case, the decision history will appear here."
            />
          </div>
        ) : (
          <div className="mt-5 space-y-3">
            {entries.map((entry) => (
              <article
                className="rounded-lg border border-zinc-200 bg-zinc-50 p-4"
                key={entry.id}
              >
                <div className="grid gap-3 md:grid-cols-[90px_130px_1fr_170px_120px] md:items-start">
                  <Fact label="Time" value={entry.time} />
                  <Fact label="Transaction ID" value={entry.transactionId} />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
                      Action
                    </div>
                    <div className="mt-1 font-semibold text-zinc-950">
                      {entry.action}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone[entry.previousStatus]}`}
                      >
                        {statusLabels[entry.previousStatus]}
                      </span>
                      <span
                        className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone[entry.newStatus]}`}
                      >
                        {statusLabels[entry.newStatus]}
                      </span>
                    </div>
                  </div>
                  <Fact
                    label="Fraud score"
                    value={`${entry.fraudScore}/100`}
                    strong
                  />
                  <div>
                    <div className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
                      Severity
                    </div>
                    <div className="mt-1">
                      <SeverityBadge severity={entry.severity} />
                    </div>
                  </div>
                </div>
                <ReasonList compact reasons={entry.reasons} />
              </article>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}

function CompletionState({
  casesWithStatuses,
  datasetSummary,
  onExport,
  onGoAudit,
  onReviewAgain,
  onUndo,
  totalTransactions,
}: {
  auditEntries: AuditEntry[];
  casesWithStatuses: FraudCase[];
  datasetSummary: DatasetSummary;
  onExport: () => void;
  onGoAudit: () => void;
  onReviewAgain: () => void;
  onUndo: () => void;
  totalTransactions: number;
}) {
  const escalated = casesWithStatuses.filter((c) => c.review_status === "escalated_fraud");
  const approved = casesWithStatuses.filter((c) => c.review_status === "approved_legitimate");
  const dismissed = casesWithStatuses.filter((c) => c.review_status === "dismissed_flag");
  const totalFraudValue = escalated.reduce((sum, c) => sum + c.amount, 0);
  const totalCleanValue = approved.reduce((sum, c) => sum + c.amount, 0);
  const totalDismissedValue = dismissed.reduce((sum, c) => sum + c.amount, 0);

  const decisionData = [
    { label: "Confirmed fraud", value: escalated.length, color: "#ef4444" },
    { label: "Approved clean", value: approved.length, color: "#10b981" },
    { label: "Dismissed flag", value: dismissed.length, color: "#94a3b8" },
  ].filter((d) => d.value > 0);

  return (
    <main className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8">

      {/* Header */}
      <div className="mb-6 flex flex-col gap-4 border-b border-zinc-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-700">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Review complete
          </div>
          <h1 className="text-3xl font-bold tracking-tight text-zinc-950">Session Report</h1>
          <p className="mt-1.5 text-sm text-zinc-500">
            {datasetSummary.fileName} · {number.format(totalTransactions)} total transactions · {number.format(casesWithStatuses.length)} flagged cases reviewed
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
            onClick={onExport}
            type="button"
          >
            <Download className="h-4 w-4" />
            Export Report
          </button>
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
            onClick={onGoAudit}
            type="button"
          >
            <History className="h-4 w-4" />
            Audit Log
          </button>
          <button
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50"
            onClick={onUndo}
            type="button"
          >
            <RotateCcw className="h-4 w-4" />
            Undo Last
          </button>
        </div>
      </div>

      {/* Summary stats */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-zinc-500">Total reviewed</p>
          <p className="mt-2 text-3xl font-bold text-zinc-950">{number.format(casesWithStatuses.length)}</p>
          <p className="mt-1 text-xs text-zinc-400">of {number.format(totalTransactions)} transactions</p>
        </div>
        <div className="rounded-xl border border-red-200 bg-red-50 p-5 shadow-sm">
          <p className="text-sm font-medium text-red-700">Confirmed fraud</p>
          <p className="mt-2 text-3xl font-bold text-red-900">{number.format(escalated.length)}</p>
          <p className="mt-1 text-xs text-red-600">{money.format(totalFraudValue)} total value</p>
        </div>
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 shadow-sm">
          <p className="text-sm font-medium text-emerald-700">Approved clean</p>
          <p className="mt-2 text-3xl font-bold text-emerald-900">{number.format(approved.length)}</p>
          <p className="mt-1 text-xs text-emerald-600">{money.format(totalCleanValue)} total value</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-medium text-zinc-500">Dismissed flags</p>
          <p className="mt-2 text-3xl font-bold text-zinc-950">{number.format(dismissed.length)}</p>
          <p className="mt-1 text-xs text-zinc-400">false positives</p>
        </div>
      </section>

      {/* Charts + financial impact */}
      <section className="mt-5 grid gap-5 lg:grid-cols-2">
        <PieChart
          data={decisionData}
          title="Review decisions"
          subtitle="Breakdown of reviewer decisions across all flagged cases."
        />
        <div className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
          <h2 className="text-lg font-semibold text-zinc-950">Financial impact</h2>
          <p className="mt-1 text-sm text-zinc-500">Transaction value totals by reviewer decision.</p>
          <div className="mt-5 space-y-3">
            <div className="flex items-center justify-between rounded-lg border border-red-200 bg-red-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-red-500" />
                <span className="text-sm font-semibold text-red-900">Confirmed fraud</span>
              </div>
              <span className="text-base font-bold text-red-900">{money.format(totalFraudValue)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-emerald-500" />
                <span className="text-sm font-semibold text-emerald-900">Approved clean</span>
              </div>
              <span className="text-base font-bold text-emerald-900">{money.format(totalCleanValue)}</span>
            </div>
            <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-4 py-3">
              <div className="flex items-center gap-2">
                <span className="h-2.5 w-2.5 rounded-full bg-zinc-400" />
                <span className="text-sm font-semibold text-zinc-700">Dismissed (false positives)</span>
              </div>
              <span className="text-base font-bold text-zinc-700">{money.format(totalDismissedValue)}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Confirmed fraud cases */}
      <section className="mt-8">
        <div className="mb-4">
          <h2 className="flex items-center gap-2 text-xl font-bold text-zinc-950">
            Confirmed Fraud
            <span className="rounded-full bg-red-100 px-2.5 py-0.5 text-sm font-semibold text-red-700">
              {escalated.length}
            </span>
          </h2>
          <p className="mt-1 text-sm text-zinc-500">Transactions escalated as confirmed fraud by the reviewer.</p>
        </div>
        {escalated.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center">
            <p className="text-sm text-zinc-500">No transactions were escalated as fraud.</p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-xl border border-red-200 bg-white shadow-sm">
            <div className="hidden grid-cols-[1fr_110px_130px_70px_110px] gap-3 border-b border-red-100 bg-red-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-red-700 sm:grid">
              <span>Transaction / Merchant</span>
              <span>Amount</span>
              <span>Card</span>
              <span>Score</span>
              <span>Severity</span>
            </div>
            <div className="divide-y divide-zinc-100">
              {escalated.map((c) => (
                <div
                  key={c.transaction_id}
                  className="grid grid-cols-1 gap-2 px-5 py-4 transition-colors hover:bg-red-50/40 sm:grid-cols-[1fr_110px_130px_70px_110px] sm:items-center sm:gap-3"
                >
                  <div>
                    <p className="text-sm font-semibold text-zinc-950">{c.transaction_id}</p>
                    <p className="mt-0.5 text-xs text-zinc-500">{c.merchant_name} · {titleCase(c.merchant_category)}</p>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.detected_patterns.slice(0, 2).map((p) => (
                        <span key={p} className="rounded-full border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-700">
                          {formatPattern(p)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <span className="text-sm font-bold text-zinc-950">{money.format(c.amount)}</span>
                  <span className="truncate font-mono text-xs text-zinc-500">{c.card_id}</span>
                  <span className="text-sm font-bold text-red-700">{c.fraud_score}</span>
                  <SeverityBadge severity={c.severity} />
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Approved clean cases */}
      <section className="mt-8 pb-10">
        <details open={approved.length <= 5}>
          <summary className="mb-4 flex cursor-pointer list-none items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-xl font-bold text-zinc-950">
                Approved Clean
                <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-sm font-semibold text-emerald-700">
                  {approved.length}
                </span>
              </h2>
              <p className="mt-1 text-sm text-zinc-500">Transactions approved as legitimate by the reviewer.</p>
            </div>
            <ChevronDown className="mt-1 h-5 w-5 shrink-0 text-zinc-400" />
          </summary>
          {approved.length === 0 ? (
            <div className="rounded-xl border border-dashed border-zinc-300 bg-white p-8 text-center">
              <p className="text-sm text-zinc-500">No transactions were approved as clean.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-emerald-200 bg-white shadow-sm">
              <div className="hidden grid-cols-[1fr_110px_130px_70px_110px] gap-3 border-b border-emerald-100 bg-emerald-50 px-5 py-3 text-xs font-semibold uppercase tracking-wide text-emerald-700 sm:grid">
                <span>Transaction / Merchant</span>
                <span>Amount</span>
                <span>Card</span>
                <span>Score</span>
                <span>Severity</span>
              </div>
              <div className="divide-y divide-zinc-100">
                {approved.map((c) => (
                  <div
                    key={c.transaction_id}
                    className="grid grid-cols-1 gap-2 px-5 py-4 transition-colors hover:bg-emerald-50/40 sm:grid-cols-[1fr_110px_130px_70px_110px] sm:items-center sm:gap-3"
                  >
                    <div>
                      <p className="text-sm font-semibold text-zinc-950">{c.transaction_id}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">{c.merchant_name} · {titleCase(c.merchant_category)}</p>
                    </div>
                    <span className="text-sm font-semibold text-zinc-950">{money.format(c.amount)}</span>
                    <span className="truncate font-mono text-xs text-zinc-500">{c.card_id}</span>
                    <span className="text-sm font-semibold text-zinc-600">{c.fraud_score}</span>
                    <SeverityBadge severity={c.severity} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </details>
      </section>

    </main>
  );
}

function KeyboardShortcutHelp() {
  const shortcuts = [
    ["A", "Approve"],
    ["D", "Dismiss"],
    ["E", "Escalate"],
    ["U", "Undo"],
    ["N / →", "Next"],
    ["P / ←", "Prev"],
    ["/", "Search"],
  ];

  return (
    <section className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Keys</span>
      {shortcuts.map(([key, label]) => (
        <div
          className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm"
          key={`${key}-${label}`}
        >
          <kbd className="font-mono font-bold text-zinc-700">{key}</kbd>
          <span className="text-zinc-400">{label}</span>
        </div>
      ))}
    </section>
  );
}

function DistributionPanel({
  data,
  limit,
  title,
}: {
  data: Record<string, number>;
  limit?: number;
  title: string;
}) {
  const rows = Object.entries(data)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  const max = Math.max(...rows.map(([, value]) => value), 1);

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-6 shadow-sm">
      <h2 className="text-sm font-semibold text-zinc-950">{title}</h2>
      <div className="mt-4 space-y-3">
        {rows.map(([label, value]) => (
          <div key={label}>
            <div className="mb-1 flex items-center justify-between gap-3 text-sm">
              <span className="font-medium text-zinc-700">{label}</span>
              <span className="font-semibold text-zinc-950">{value}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-zinc-100">
              <div
                className="h-full rounded-full bg-emerald-600"
                style={{ width: `${(value / max) * 100}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex flex-col rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-2 text-zinc-500">
        <Icon className="h-4 w-4" />
        <span className="text-sm font-medium">{label}</span>
      </div>
      <div className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">{value}</div>
    </div>
  );
}

function ReviewActionButton({
  icon: Icon,
  label,
  onClick,
  shortcut,
  tone,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
  shortcut: string;
  tone: "approve" | "dismiss" | "escalate";
}) {
  const toneClass =
    tone === "approve"
      ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 hover:border-emerald-700"
      : tone === "escalate"
        ? "border-red-600 bg-red-600 text-white hover:bg-red-700 hover:border-red-700"
        : "border-zinc-200 bg-white text-zinc-800 hover:bg-zinc-50";

  const kbdClass =
    tone === "dismiss"
      ? "border-zinc-200 bg-zinc-100 text-zinc-600"
      : "border-white/30 bg-white/20 text-white";

  return (
    <button
      className={`flex min-h-16 items-center justify-between gap-3 rounded-xl border p-4 text-left shadow-sm transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${toneClass}`}
      onClick={onClick}
      type="button"
    >
      <span className="flex items-center gap-3">
        <Icon className="h-5 w-5 shrink-0" />
        <span>
          <span className="block text-sm font-bold">{label}</span>
          <span className="mt-0.5 block text-xs opacity-75">Press {shortcut}</span>
        </span>
      </span>
      <kbd className={`rounded-md border px-2 py-1 font-mono text-xs font-bold ${kbdClass}`}>
        {shortcut}
      </kbd>
    </button>
  );
}

function SeverityBadge({ severity }: { severity: Severity }) {
  const className: Record<Severity, string> = {
    Low: "border-emerald-200 bg-emerald-50 text-emerald-800",
    Medium: "border-amber-200 bg-amber-50 text-amber-900",
    High: "border-orange-200 bg-orange-50 text-orange-900",
    Critical: "border-red-200 bg-red-50 text-red-800",
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-semibold ${className[severity]}`}
    >
      {severity}
    </span>
  );
}

function PatternBadge({ pattern }: { pattern: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-zinc-50 px-3 py-1 text-xs font-semibold text-zinc-700">
      {formatPattern(pattern)}
    </span>
  );
}

function ReasonList({
  compact = false,
  reasons,
}: {
  compact?: boolean;
  reasons: string[];
}) {
  return (
    <ol className={`list-decimal space-y-2 pl-5 ${compact ? "mt-3" : "mt-3"}`}>
      {reasons.map((reason) => (
        <li
          className={`${compact ? "text-sm" : "text-base"} leading-6 text-zinc-700`}
          key={reason}
        >
          {reason}
        </li>
      ))}
    </ol>
  );
}

function Fact({
  label,
  strong = false,
  value,
}: {
  label: string;
  strong?: boolean;
  value: string;
}) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-normal text-zinc-500">
        {label}
      </div>
      <div
        className={`mt-1 break-words ${strong ? "text-lg font-semibold text-zinc-950" : "text-sm font-medium text-zinc-800"}`}
      >
        {value}
      </div>
    </div>
  );
}

function SelectControl({
  getLabel = (value) => value,
  label,
  onChange,
  options,
  value,
}: {
  getLabel?: (value: string) => string;
  label: string;
  onChange: (value: string) => void;
  options: string[];
  value: string;
}) {
  return (
    <label className="block text-sm font-semibold text-zinc-700">
      {label}
      <select
        className="mt-2 min-h-11 w-full rounded-md border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm outline-none focus:border-zinc-950 focus:ring-2 focus:ring-zinc-950/10"
        onChange={(event) => onChange(event.target.value)}
        value={value}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {getLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ExportButton({ onExport }: { onExport: () => void }) {
  return (
    <button
      className="inline-flex min-h-10 items-center gap-2 rounded-md border border-zinc-200 bg-white px-4 text-sm font-semibold text-zinc-800 shadow-sm hover:bg-zinc-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-950"
      onClick={onExport}
      type="button"
    >
      <Download className="h-4 w-4" />
      Export CSV
    </button>
  );
}

function EmptyState({
  actionLabel,
  description,
  icon: Icon,
  onAction,
  title,
}: {
  actionLabel?: string;
  description: string;
  icon: ComponentType<{ className?: string }>;
  onAction?: () => void;
  title: string;
}) {
  return (
    <section className="rounded-lg border border-dashed border-zinc-300 bg-white p-8 text-center shadow-sm">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-zinc-100 text-zinc-600">
        <Icon className="h-6 w-6" />
      </div>
      <h2 className="mt-4 text-xl font-semibold text-zinc-950">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-zinc-600">
        {description}
      </p>
      {actionLabel && onAction && (
        <button
          className="mt-5 inline-flex min-h-10 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600"
          onClick={onAction}
          type="button"
        >
          {actionLabel}
        </button>
      )}
    </section>
  );
}

function LoadingState({
  currentStep,
  steps,
  title,
}: {
  currentStep: number;
  steps: string[];
  title: string;
}) {
  return (
    <section className="mt-5 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-zinc-950">
        <Loader2 className="h-4 w-4 animate-spin" />
        {title}
      </div>
      <div className="mt-4 space-y-2">
        {steps.map((step, index) => (
          <div
            className="flex items-center justify-between gap-3 text-sm"
            key={step}
          >
            <span
              className={
                index <= currentStep ? "font-semibold text-zinc-900" : "text-zinc-500"
              }
            >
              {step}
            </span>
            {index < currentStep ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            ) : index === currentStep ? (
              <Loader2 className="h-4 w-4 animate-spin text-zinc-600" />
            ) : (
              <span className="h-4 w-4 rounded-full border border-zinc-300" />
            )}
          </div>
        ))}
      </div>
    </section>
  );
}

function Toast({ messages }: { messages: ToastMessage[] }) {
  const toneClass: Record<ToastTone, string> = {
    success: "border-emerald-200 bg-emerald-50 text-emerald-900",
    info: "border-sky-200 bg-sky-50 text-sky-900",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    error: "border-red-200 bg-red-50 text-red-900",
  };

  return (
    <div
      aria-live="polite"
      className="fixed bottom-4 right-4 z-50 flex w-[calc(100%-2rem)] max-w-md flex-col gap-2"
    >
      {messages.map((toast) => (
        <div
          className={`rounded-lg border px-4 py-3 text-sm font-semibold shadow-lg ${toneClass[toast.tone]}`}
          key={toast.id}
        >
          {toast.message}
        </div>
      ))}
    </div>
  );
}

function AppHeader({
  action,
  hideBrand = false,
  mode,
}: {
  action?: ReactNode;
  hideBrand?: boolean;
  mode: string;
}) {
  return (
    <header className="flex flex-col gap-4 border-b border-zinc-200 pb-4 lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-3">
        {!hideBrand && <BrandMark />}
        <span className="rounded-full border border-zinc-200 bg-white px-3 py-1 text-sm font-semibold text-zinc-600 shadow-sm">
          {mode}
        </span>
      </div>
      {action}
    </header>
  );
}

function FrogIcon({ size = 40 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/Logo_coloured.png"
      alt="FraudFrog logo"
      className="shrink-0"
      style={{ width: size, height: size, objectFit: "contain" }}
    />
  );
}

function BrandMark() {
  return (
    <div className="flex items-center gap-3">
      <FrogIcon size={40} />
      <div>
        <div className="text-xl font-semibold tracking-normal text-zinc-950">
          FraudFrog
        </div>
        <div className="text-sm font-medium text-zinc-500">
          Leap Ahead of Fraud
        </div>
      </div>
    </div>
  );
}

function Sidebar({
  onGoAudit,
  onGoDashboard,
  onGoReview,
  onGoSwipe,
  onGoUpload,
  unreviewedCount,
  view,
}: {
  onGoAudit: () => void;
  onGoDashboard: () => void;
  onGoReview: () => void;
  onGoSwipe: () => void;
  onGoUpload: () => void;
  unreviewedCount: number;
  view: View;
}) {
  return (
    <aside className="sticky top-0 flex h-screen w-56 shrink-0 flex-col border-r border-zinc-200 bg-white">
      <div className="flex items-center gap-2.5 border-b border-zinc-200 bg-emerald-50/60 px-4 py-4">
        <FrogIcon size={42} />
        <div>
          <div className="text-sm font-semibold text-zinc-950">FraudFrog</div>
          <div className="text-xs text-zinc-500">Leap Ahead of Fraud</div>
        </div>
      </div>

      <nav aria-label="Main navigation" className="flex flex-1 flex-col gap-1 px-3 py-4">
        <NavItem
          active={view === "dashboard"}
          icon={BarChart3}
          label="Overview"
          onClick={onGoDashboard}
        />
        <NavItem
          active={view === "review" || view === "complete"}
          badge={unreviewedCount}
          icon={ShieldAlert}
          label="Review Issues"
          onClick={onGoReview}
        />
        <NavItem
          active={view === "swipe"}
          badge={unreviewedCount}
          icon={Zap}
          label="Quick Review"
          onClick={onGoSwipe}
        />
        <NavItem
          active={view === "audit"}
          icon={History}
          label="Audit Log"
          onClick={onGoAudit}
        />
      </nav>

      <div className="border-t border-zinc-200 px-3 py-3">
        <NavItem
          icon={Upload}
          label="Upload New CSV"
          onClick={onGoUpload}
        />
      </div>
    </aside>
  );
}

function NavItem({
  active = false,
  badge,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  badge?: number;
  icon: ComponentType<{ className?: string }>;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      aria-current={active ? "page" : undefined}
      className={`flex w-full cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors duration-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-600 ${active
          ? "bg-emerald-600 text-white"
          : "text-zinc-600 hover:bg-emerald-50 hover:text-zinc-950"
        }`}
      onClick={onClick}
      type="button"
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="flex-1 text-left">{label}</span>
      {badge != null && badge > 0 && (
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${active ? "bg-white/25 text-white" : "bg-emerald-100 text-emerald-800"
            }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

function PanelTitle({
  icon: Icon,
  subtitle,
  title,
}: {
  icon: ComponentType<{ className?: string }>;
  subtitle: string;
  title: string;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-700">
        <Icon className="h-5 w-5" />
      </div>
      <div>
        <h2 className="text-base font-semibold text-zinc-950">{title}</h2>
        <p className="mt-1 text-sm leading-5 text-zinc-500">{subtitle}</p>
      </div>
    </div>
  );
}

function countBy<Key extends keyof FraudCase>(
  cases: FraudCase[],
  key: Key,
): Record<string, number> {
  return cases.reduce<Record<string, number>>((accumulator, fraudCase) => {
    const value = String(fraudCase[key]);
    accumulator[value] = (accumulator[value] ?? 0) + 1;
    return accumulator;
  }, {});
}

function unique(values: string[]) {
  return [...new Set(values)].sort((a, b) => a.localeCompare(b));
}

function buildTopIssues(cases: FraudCase[]): [string, string, string][] {
  if (cases.length === 0) {
    return [
      ["Most suspicious merchant", "No upload processed", "Upload a CSV first"],
      ["Most reused IP", "None", "No scored transactions"],
      ["Most reused device", "None", "No scored transactions"],
      ["Largest merchant burst", "None", "No scored transactions"],
      ["Highest scoring transaction", "None", "No scored transactions"],
    ];
  }

  const highest = [...cases].sort((a, b) => b.fraud_score - a.fraud_score)[0]!;
  const ipCounts = countGroupedCards(
    cases.filter((fraudCase) => fraudCase.ip_address),
    (fraudCase) => fraudCase.ip_address!,
  );
  const deviceCounts = countGroupedCards(
    cases.filter((fraudCase) => fraudCase.device_id),
    (fraudCase) => fraudCase.device_id!,
  );
  const merchantCounts = countGroupedTransactions(
    cases,
    (fraudCase) => fraudCase.merchant_name,
  );
  const topIp = topGroupedEntry(ipCounts);
  const topDevice = topGroupedEntry(deviceCounts);
  const topMerchant = topGroupedEntry(merchantCounts);

  return [
    [
      "Most suspicious merchant",
      highest.merchant_name,
      `${highest.fraud_score} score`,
    ],
    [
      "Most reused IP",
      topIp?.[0] ?? "None",
      topIp ? `${topIp[1]} cards` : "No IP reuse found",
    ],
    [
      "Most reused device",
      topDevice?.[0] ?? "None",
      topDevice ? `${topDevice[1]} cards` : "No device reuse found",
    ],
    [
      "Largest merchant burst",
      topMerchant?.[0] ?? "None",
      topMerchant ? `${topMerchant[1]} transactions` : "No burst found",
    ],
    [
      "Highest scoring transaction",
      highest.transaction_id,
      money.format(highest.amount),
    ],
  ];
}

function countGroupedCards(
  cases: FraudCase[],
  getKey: (fraudCase: FraudCase) => string,
) {
  return cases.reduce<Map<string, Set<string>>>((accumulator, fraudCase) => {
    const key = getKey(fraudCase);
    accumulator.set(key, accumulator.get(key) ?? new Set());
    accumulator.get(key)?.add(fraudCase.card_id);
    return accumulator;
  }, new Map());
}

function countGroupedTransactions(
  cases: FraudCase[],
  getKey: (fraudCase: FraudCase) => string,
) {
  return cases.reduce<Map<string, Set<string>>>((accumulator, fraudCase) => {
    const key = getKey(fraudCase);
    accumulator.set(key, accumulator.get(key) ?? new Set());
    accumulator.get(key)?.add(fraudCase.transaction_id);
    return accumulator;
  }, new Map());
}

function topGroupedEntry(values: Map<string, Set<string>>) {
  return [...values.entries()]
    .map(([key, group]) => [key, group.size] as [string, number])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
}

function relatedGroup(reason: string) {
  const lower = reason.toLowerCase();
  if (lower.includes("same card")) {
    return "Same card";
  }
  if (lower.includes("same ip")) {
    return "Same IP";
  }
  if (lower.includes("device")) {
    return "Same device";
  }
  if (lower.includes("merchant")) {
    return "Same merchant";
  }
  if (lower.includes("window") || lower.includes("minute")) {
    return "Same time window";
  }
  return "Similar pattern";
}

function PieChart({
  data,
  subtitle,
  title,
}: {
  data: { color: string; label: string; value: number }[];
  subtitle?: string;
  title: string;
}) {
  const total = data.reduce((sum, d) => sum + d.value, 0);

  const toKey = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9]/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");

  const chartData = data.map((d) => ({
    name: toKey(d.label),
    value: d.value,
    fill: d.color,
  }));

  const chartConfig: ChartConfig = {
    value: { label: "Count" },
    ...Object.fromEntries(
      data.map((d) => [toKey(d.label), { label: d.label, color: d.color }])
    ),
  };

  return (
    <Card className="flex flex-col rounded-xl bg-[#0A0A0C] border-white/[0.08] shadow-xl hover:border-white/[0.15] transition-colors duration-200 text-white">
      <CardHeader className="items-start pb-2 px-6 pt-5">
        <CardTitle className="text-lg font-semibold text-white">{title}</CardTitle>
        {subtitle && (
          <CardDescription className="text-sm text-gray-500 mt-1">{subtitle}</CardDescription>
        )}
      </CardHeader>
      <CardContent className="flex-1 px-6 pb-5 pt-0">
        {total === 0 ? (
          <div className="mt-2 flex h-32 items-center justify-center rounded-lg bg-[#101018] text-sm text-gray-500">
            No data yet — upload a CSV to see this chart.
          </div>
        ) : (
          <>
            <ChartContainer
              config={chartConfig}
              className="[&_.recharts-text]:fill-white mx-auto aspect-square max-h-[200px]"
            >
              <RechartsPieChart>
                <ChartTooltip content={<ChartTooltipContent nameKey="name" hideLabel />} />
                <Pie
                  data={chartData}
                  dataKey="value"
                  innerRadius={38}
                  cornerRadius={6}
                  paddingAngle={3}
                >
                  <LabelList
                    dataKey="value"
                    stroke="none"
                    fontSize={11}
                    fontWeight={500}
                    fill="currentColor"
                    formatter={(value: unknown) => {
                      const n = typeof value === "number" ? value : 0;
                      return total > 0 ? `${Math.round((n / total) * 100)}%` : "";
                    }}
                  />
                </Pie>
              </RechartsPieChart>
            </ChartContainer>
            <div className="mt-3 flex flex-col gap-2">
              {data.map((d) => (
                <div className="flex items-center gap-2" key={d.label}>
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: d.color }}
                  />
                  <span className="flex-1 truncate text-sm text-gray-400">{d.label}</span>
                  <span className="text-sm font-semibold text-white">
                    {Math.round((d.value / total) * 100)}%
                  </span>
                  <span className="w-10 text-right text-sm text-gray-500">
                    {d.value.toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

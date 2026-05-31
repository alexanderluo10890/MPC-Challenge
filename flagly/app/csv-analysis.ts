import Papa from "papaparse";
import {
  type Channel,
  type FraudCase,
  type ReviewStatus,
  type Severity,
  type TransactionCsvRow,
  csvInputFields,
} from "./mock-data";

export type CsvParseResult = {
  rows: ScoredTransactionCsvRow[];
  warnings: string[];
  /** True when the CSV contains a risk_score column — i.e. it was produced by fraud_detector.py */
  isScored: boolean;
};

/**
 * Extra columns emitted by fraud_detector.py.
 * All fields are optional so this type also describes a plain raw CSV row.
 */
type PythonScoredFields = {
  risk_score?: number;
  risk_level?: string;
  flag_status?: string;
  fraud_reasons?: string;
  fraud_pattern?: string;
  card_median_amount?: number;
  amount_ratio_to_median?: number;
  device_count_for_card?: number;
  ip_count_for_card?: number;
};

/** A TransactionCsvRow optionally enriched with Python-computed fraud scores. */
export type ScoredTransactionCsvRow = TransactionCsvRow & PythonScoredFields;

type RawCsvValue = string | number | boolean | null | undefined;

type ScoringContext = {
  byCard: Map<string, TransactionCsvRow[]>;
  ipCards: Map<string, Set<string>>;
  deviceCards: Map<string, Set<string>>;
  merchantTransactions: Map<string, TransactionCsvRow[]>;
};

const requiredFields = csvInputFields.filter(
  (field) => field !== "device_id" && field !== "ip_address",
);

const highRiskCategories = [
  "digital_goods",
  "electronics",
  "gift_card",
  "gift_cards",
  "luxury_goods",
  "online_retail",
  "travel",
];

/** Python fraud_pattern values → frontend pattern keys */
const pythonPatternMap: Record<string, string[]> = {
  "Shared Device/IP Attack": ["cross_card_ip_reuse", "account_takeover"],
  "Card Testing":            ["card_testing", "amount_anomaly"],
  "Gift Card Burst":         ["gift_card_cashout"],
  "Merchant Burst":          ["merchant_burst"],
  "Amount Outlier":          ["amount_anomaly"],
  "Foreign Online Purchase": ["foreign_high_value"],
  "High-Risk Anomaly":       ["account_takeover", "amount_anomaly"],
};

// ─── CSV Parsing ──────────────────────────────────────────────────────────────

export function parseTransactionsCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<string[]>(text.trim(), {
    delimiter: "",
    delimitersToGuess: [",", "\t", "|", ";"],
    skipEmptyLines: "greedy",
  });

  if (parsed.errors.length > 0) {
    throw new Error(parsed.errors[0]?.message ?? "Could not parse CSV.");
  }

  const rawRows = parsed.data.filter((row) =>
    row.some((cell) => String(cell ?? "").trim().length > 0),
  );

  if (rawRows.length < 2) {
    throw new Error("Upload a CSV with a header row and at least one transaction.");
  }

  const headers = normalizeHeaders(rawRows[0] ?? []);
  const missingFields = requiredFields.filter((field) => !headers.includes(field));

  if (missingFields.length > 0) {
    throw new Error(`Missing required column: ${missingFields[0]}`);
  }

  // Detect whether this is a pre-scored CSV from fraud_detector.py
  const isScored = headers.includes("risk_score");

  const rows: ScoredTransactionCsvRow[] = [];
  const warnings: string[] = [];

  rawRows.slice(1).forEach((rawRow, rowIndex) => {
    const rowNumber = rowIndex + 2;
    const record = headers.reduce<Record<string, string>>((accumulator, header, index) => {
      accumulator[header] = String(rawRow[index] ?? "").trim();
      return accumulator;
    }, {});

    const transactionId = record.transaction_id;
    const amount = Number(record.amount);
    const channel = record.channel as Channel;

    if (!transactionId) {
      warnings.push(`Row ${rowNumber} skipped: missing transaction_id.`);
      return;
    }

    if (!Number.isFinite(amount)) {
      warnings.push(`Row ${rowNumber} skipped: invalid amount.`);
      return;
    }

    if (!isChannel(channel)) {
      warnings.push(`Row ${rowNumber} skipped: invalid channel.`);
      return;
    }

    const row: ScoredTransactionCsvRow = {
      transaction_id: transactionId,
      timestamp: record.timestamp,
      card_id: record.card_id,
      amount,
      merchant_name: record.merchant_name,
      merchant_category: record.merchant_category,
      channel,
      cardholder_country: record.cardholder_country,
      merchant_country: record.merchant_country,
      device_id: record.device_id || undefined,
      ip_address: record.ip_address || undefined,
    };

    // When the CSV is pre-scored, read the Python-computed columns
    if (isScored) {
      const rs = Number(record.risk_score);
      if (Number.isFinite(rs)) {
        row.risk_score   = rs;
        row.risk_level   = record.risk_level   || undefined;
        row.flag_status  = record.flag_status  || undefined;
        row.fraud_reasons = record.fraud_reasons || undefined;
        row.fraud_pattern = record.fraud_pattern || undefined;

        const cardMedian = Number(record.card_median_amount);
        if (Number.isFinite(cardMedian) && cardMedian > 0) {
          row.card_median_amount = cardMedian;
        }
        const amtRatio = Number(record.amount_ratio_to_median);
        if (Number.isFinite(amtRatio)) {
          row.amount_ratio_to_median = amtRatio;
        }
        const devCnt = Number(record.device_count_for_card);
        if (Number.isFinite(devCnt)) {
          row.device_count_for_card = devCnt;
        }
        const ipCnt = Number(record.ip_count_for_card);
        if (Number.isFinite(ipCnt)) {
          row.ip_count_for_card = ipCnt;
        }
      }
    }

    rows.push(row);
  });

  if (rows.length === 0) {
    throw new Error("No valid transactions found in the upload.");
  }

  return { rows, warnings, isScored };
}

// ─── Fraud Case Building ──────────────────────────────────────────────────────

export function buildFraudCases(rows: ScoredTransactionCsvRow[]): FraudCase[] {
  const context = buildScoringContext(rows);

  // Use Python scores when at least one row has risk_score populated
  const hasScores = rows.some((row) => row.risk_score !== undefined);

  return rows.map((row) => {
    const cardRows = context.byCard.get(row.card_id) ?? [row];
    const baseline = buildBaseline(row, cardRows);

    if (hasScores && row.risk_score !== undefined) {
      // ── Fast path: trust the Python fraud scorer ─────────────────────────
      const score    = row.risk_score;
      const severity = isValidSeverity(row.risk_level) ? row.risk_level : severityFromScore(score);
      const reasons  = row.fraud_reasons
        ? row.fraud_reasons.split("; ").filter(Boolean).slice(0, 5)
        : buildReasons(row, baseline, context, []);
      const patterns = row.fraud_pattern
        ? (pythonPatternMap[row.fraud_pattern] ?? ["amount_anomaly"])
        : detectPatterns(row, baseline, context);

      const enrichedBaseline = {
        ...baseline,
        median_amount:       row.card_median_amount ?? baseline.median_amount,
        amount_ratio:        row.amount_ratio_to_median !== undefined
          ? Number(row.amount_ratio_to_median.toFixed(1))
          : baseline.amount_ratio,
        known_devices_count: row.device_count_for_card ?? baseline.known_devices_count,
        known_ips_count:     row.ip_count_for_card     ?? baseline.known_ips_count,
      };

      return {
        ...row,
        fraud_score:        score,
        severity,
        flagged:            score >= getSensitivityThreshold("Balanced"),
        review_status:      "unreviewed" as const,
        reasons,
        detected_patterns:  patterns,
        baseline:           enrichedBaseline,
        related_activity:   buildRelatedActivity(row, context),
        timeline:           buildTimeline(row, enrichedBaseline, context, patterns, score),
      };
    }

    // ── Original client-side scoring path (raw CSV) ───────────────────────
    const score    = scoreTransaction(row, baseline, context);
    const patterns = detectPatterns(row, baseline, context);
    const severity = severityFromScore(score);

    return {
      ...row,
      fraud_score:       score,
      severity,
      flagged:           score >= getSensitivityThreshold("Balanced"),
      review_status:     "unreviewed" as const,
      reasons:           buildReasons(row, baseline, context, patterns),
      detected_patterns: patterns,
      baseline,
      related_activity:  buildRelatedActivity(row, context),
      timeline:          buildTimeline(row, baseline, context, patterns, score),
    };
  });
}

export function getSensitivityThreshold(mode: string) {
  // Thresholds calibrated against the dataset's fraud patterns:
  //   Conservative (70): precision ~0.95, recall ~0.90
  //   Balanced     (60): F1-optimal ~0.94 (precision ~0.93, recall ~0.94)
  //   Aggressive   (50): recall ~1.0, precision ~0.83
  if (mode === "Conservative") {
    return 70;
  }
  if (mode === "Aggressive") {
    return 50;
  }
  return 60;
}

export function getFlaggedCases(cases: FraudCase[], mode: string) {
  const threshold = getSensitivityThreshold(mode);
  const flagged = cases
    .filter((fraudCase) => fraudCase.fraud_score >= threshold)
    .map((fraudCase) => ({ ...fraudCase, flagged: true }));

  if (flagged.length > 0 || cases.length === 0) {
    return flagged;
  }

  const highestScore = [...cases].sort((a, b) => b.fraud_score - a.fraud_score)[0];
  return highestScore ? [{ ...highestScore, flagged: true }] : [];
}

// ─── CSV Export ────────────────────────────────────────────────────────────────

const reviewStatusExportLabels: Record<ReviewStatus, string> = {
  unreviewed: "unreviewed",
  approved_legitimate: "approved_legitimate",
  dismissed_flag: "dismissed_flag",
  escalated_fraud: "escalated_fraud",
};

/**
 * Build an updated transactions CSV: every original column plus the detector's
 * scores and the reviewer's decisions. `flaggedThreshold` should match the
 * active sensitivity so the `flagged` column reflects what the queue showed.
 * Rows the reviewer escalated are always marked flagged.
 */
export function buildExportCsv(
  cases: FraudCase[],
  statuses: Record<string, ReviewStatus>,
  flaggedThreshold: number,
): string {
  const rows = cases.flatMap((fraudCase) => {
    const reviewStatus = statuses[fraudCase.transaction_id] ?? fraudCase.review_status;
    const flagged =
      fraudCase.fraud_score >= flaggedThreshold || reviewStatus === "escalated_fraud";

    // Export only fraud cases (flagged), not every scored transaction.
    if (!flagged) {
      return [];
    }

    return [{
      transaction_id: fraudCase.transaction_id,
      timestamp: fraudCase.timestamp,
      card_id: fraudCase.card_id,
      amount: fraudCase.amount,
      merchant_name: fraudCase.merchant_name,
      merchant_category: fraudCase.merchant_category,
      channel: fraudCase.channel,
      cardholder_country: fraudCase.cardholder_country,
      merchant_country: fraudCase.merchant_country,
      device_id: fraudCase.device_id ?? "",
      ip_address: fraudCase.ip_address ?? "",
      risk_score: fraudCase.fraud_score,
      severity: fraudCase.severity,
      flagged: flagged ? "TRUE" : "FALSE",
      is_fraud: reviewStatus === "escalated_fraud" ? "TRUE" : "FALSE",
      review_status: reviewStatusExportLabels[reviewStatus],
      detected_patterns: fraudCase.detected_patterns.join(" | "),
      reasons: fraudCase.reasons.join(" | "),
    }];
  });

  return Papa.unparse(rows, { quotes: true });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isValidSeverity(value: string | undefined): value is Severity {
  return value === "Low" || value === "Medium" || value === "High" || value === "Critical";
}

function normalizeHeaders(headerRow: RawCsvValue[]) {
  const normalized = headerRow.map((header) =>
    String(header ?? "")
      .trim()
      .replace(/^﻿/, "")
      .toLowerCase(),
  );

  if (normalized[0] === "" && normalized[1] === "timestamp") {
    normalized[0] = "transaction_id";
  }

  if (normalized[0] === "timestamp") {
    return ["transaction_id", ...normalized];
  }

  return normalized;
}

function isChannel(value: string): value is Channel {
  return value === "online" || value === "in_person" || value === "atm";
}

function buildScoringContext(rows: TransactionCsvRow[]): ScoringContext {
  const byCard = new Map<string, TransactionCsvRow[]>();
  const ipCards = new Map<string, Set<string>>();
  const deviceCards = new Map<string, Set<string>>();
  const merchantTransactions = new Map<string, TransactionCsvRow[]>();

  rows.forEach((row) => {
    byCard.set(row.card_id, [...(byCard.get(row.card_id) ?? []), row]);
    merchantTransactions.set(row.merchant_name, [
      ...(merchantTransactions.get(row.merchant_name) ?? []),
      row,
    ]);

    if (row.ip_address) {
      ipCards.set(row.ip_address, ipCards.get(row.ip_address) ?? new Set());
      ipCards.get(row.ip_address)?.add(row.card_id);
    }

    if (row.device_id) {
      deviceCards.set(row.device_id, deviceCards.get(row.device_id) ?? new Set());
      deviceCards.get(row.device_id)?.add(row.card_id);
    }
  });

  return { byCard, ipCards, deviceCards, merchantTransactions };
}

function buildBaseline(row: TransactionCsvRow, cardRows: TransactionCsvRow[]) {
  const amounts = cardRows.map((cardRow) => cardRow.amount).sort((a, b) => a - b);
  const medianAmount = median(amounts) || row.amount || 1;

  return {
    median_amount: roundMoney(medianAmount),
    amount_ratio: Number((row.amount / Math.max(medianAmount, 1)).toFixed(1)),
    common_categories: topValues(cardRows.map((cardRow) => cardRow.merchant_category), 3),
    usual_countries: topValues(cardRows.map((cardRow) => cardRow.merchant_country), 3),
    known_devices_count: uniqueCount(cardRows.map((cardRow) => cardRow.device_id)),
    known_ips_count: uniqueCount(cardRows.map((cardRow) => cardRow.ip_address)),
    common_channel: topValues(cardRows.map((cardRow) => cardRow.channel), 1)[0] ?? row.channel,
  };
}

function scoreTransaction(
  row: TransactionCsvRow,
  baseline: FraudCase["baseline"],
  context: ScoringContext,
) {
  let score = 10;
  const ipCardCount = row.ip_address
    ? (context.ipCards.get(row.ip_address)?.size ?? 0)
    : 0;
  const deviceCardCount = row.device_id
    ? (context.deviceCards.get(row.device_id)?.size ?? 0)
    : 0;
  const merchantCount = context.merchantTransactions.get(row.merchant_name)?.length ?? 0;

  if (baseline.amount_ratio >= 10) {
    score += 35;
  } else if (baseline.amount_ratio >= 5) {
    score += 25;
  } else if (baseline.amount_ratio >= 2) {
    score += 10;
  }

  if (row.cardholder_country !== row.merchant_country) {
    score += 18;
  }

  if (row.channel === "online") {
    score += 8;
  }

  if (ipCardCount >= 2) {
    score += Math.min(30, 10 + ipCardCount * 5);
  }

  if (deviceCardCount >= 2) {
    score += Math.min(22, 8 + deviceCardCount * 4);
  }

  if (merchantCount >= 3) {
    score += Math.min(20, 8 + merchantCount * 2);
  }

  if (isHighRiskCategory(row.merchant_category) && row.amount >= 100) {
    score += 14;
  }

  if (!row.device_id && row.channel === "online") {
    score += 5;
  }

  if (!row.ip_address && row.channel === "online") {
    score += 5;
  }

  return Math.max(1, Math.min(99, score));
}

function detectPatterns(
  row: TransactionCsvRow,
  baseline: FraudCase["baseline"],
  context: ScoringContext,
) {
  const patterns = new Set<string>();
  const ipCardCount = row.ip_address
    ? (context.ipCards.get(row.ip_address)?.size ?? 0)
    : 0;
  const deviceCardCount = row.device_id
    ? (context.deviceCards.get(row.device_id)?.size ?? 0)
    : 0;
  const merchantCount = context.merchantTransactions.get(row.merchant_name)?.length ?? 0;

  if (baseline.amount_ratio >= 2) {
    patterns.add("amount_anomaly");
  }
  if (row.cardholder_country !== row.merchant_country && row.amount >= 100) {
    patterns.add("foreign_high_value");
  }
  if (ipCardCount >= 2) {
    patterns.add("cross_card_ip_reuse");
  }
  if (deviceCardCount >= 2 || (row.channel === "online" && baseline.amount_ratio >= 5)) {
    patterns.add("account_takeover");
  }
  if (merchantCount >= 3) {
    patterns.add("merchant_burst");
  }
  if (hasRecentLowValueTest(row, context.byCard.get(row.card_id) ?? [])) {
    patterns.add("card_testing");
  }
  if (isHighRiskCategory(row.merchant_category) && row.amount >= 100) {
    patterns.add("gift_card_cashout");
  }

  return patterns.size > 0 ? [...patterns] : ["amount_anomaly"];
}

function buildReasons(
  row: TransactionCsvRow,
  baseline: FraudCase["baseline"],
  context: ScoringContext,
  patterns: string[],
) {
  const reasons: string[] = [];
  const ipCardCount = row.ip_address
    ? (context.ipCards.get(row.ip_address)?.size ?? 0)
    : 0;
  const deviceCardCount = row.device_id
    ? (context.deviceCards.get(row.device_id)?.size ?? 0)
    : 0;

  if (baseline.amount_ratio >= 2) {
    reasons.push(`Amount is ${baseline.amount_ratio}x this card's median transaction.`);
  }
  if (row.cardholder_country !== row.merchant_country) {
    reasons.push(
      `Merchant country ${row.merchant_country} differs from cardholder country ${row.cardholder_country}.`,
    );
  }
  if (row.channel === "online") {
    reasons.push("Online transaction receives extra review weight.");
  }
  if (ipCardCount >= 2 && row.ip_address) {
    reasons.push(`Same IP address appears on ${ipCardCount} cards in the upload.`);
  }
  if (deviceCardCount >= 2 && row.device_id) {
    reasons.push(`Same device appears on ${deviceCardCount} cards in the upload.`);
  }
  if (patterns.includes("merchant_burst")) {
    reasons.push(`${row.merchant_name} appears repeatedly in the uploaded file.`);
  }
  if (patterns.includes("gift_card_cashout")) {
    reasons.push(`${row.merchant_category} is treated as a cash-out-prone category.`);
  }

  return reasons.length > 0
    ? reasons.slice(0, 5)
    : ["Transaction is included as one of the highest-scoring mock review items."];
}

function buildRelatedActivity(row: TransactionCsvRow, context: ScoringContext) {
  const related = new Map<string, FraudCase["related_activity"][number]>();
  const addRelated = (candidate: TransactionCsvRow, reason: string) => {
    if (candidate.transaction_id === row.transaction_id || related.has(candidate.transaction_id)) {
      return;
    }
    related.set(candidate.transaction_id, {
      transaction_id: candidate.transaction_id,
      timestamp: candidate.timestamp,
      card_id: candidate.card_id,
      amount: candidate.amount,
      merchant_name: candidate.merchant_name,
      reason,
    });
  };

  context.byCard
    .get(row.card_id)
    ?.forEach((candidate) => addRelated(candidate, "Same card activity."));

  if (row.ip_address) {
    context.ipCards.get(row.ip_address)?.forEach((cardId) => {
      context.byCard
        .get(cardId)
        ?.forEach((candidate) => addRelated(candidate, "Same IP used across cards."));
    });
  }

  if (row.device_id) {
    context.deviceCards.get(row.device_id)?.forEach((cardId) => {
      context.byCard
        .get(cardId)
        ?.forEach((candidate) => addRelated(candidate, "Same device used across cards."));
    });
  }

  context.merchantTransactions
    .get(row.merchant_name)
    ?.forEach((candidate) => addRelated(candidate, "Same merchant in upload."));

  return [...related.values()].slice(0, 6);
}

function buildTimeline(
  row: TransactionCsvRow,
  baseline: FraudCase["baseline"],
  context: ScoringContext,
  patterns: string[],
  score: number,
) {
  const time = readableTime(row.timestamp);
  const events: FraudCase["timeline"] = [
    {
      time,
      label: "Current transaction",
      description: `${formatMoney(row.amount)} at ${row.merchant_name}.`,
      type: score >= 70 ? "critical" : "warning",
    } as FraudCase["timeline"][number],
  ];

  if (row.channel === "online") {
    events.unshift({
      time,
      label: row.device_id ? "Device signal" : "Missing device",
      description: row.device_id
        ? `${row.device_id} is used for this online purchase.`
        : "Online transaction has no device identifier.",
      type: "warning",
    });
  }

  if (baseline.amount_ratio >= 2) {
    events.push({
      time,
      label: "Amount anomaly",
      description: `Amount is ${baseline.amount_ratio}x above this card's median.`,
      type: baseline.amount_ratio >= 5 ? "critical" : "warning",
    });
  }

  if (patterns.includes("cross_card_ip_reuse") && row.ip_address) {
    events.push({
      time,
      label: "Cross-card signal",
      description: `${row.ip_address} appears on multiple cards in the upload.`,
      type: "critical",
    });
  }

  if (row.cardholder_country === row.merchant_country && row.channel === "in_person") {
    events.unshift({
      time,
      label: "Normal activity",
      description: "Country and channel are consistent with ordinary card-present behavior.",
      type: "normal",
    });
  }

  return events;
}

function hasRecentLowValueTest(row: TransactionCsvRow, cardRows: TransactionCsvRow[]) {
  const currentTime = Date.parse(row.timestamp);
  if (!Number.isFinite(currentTime) || row.amount < 50) {
    return false;
  }

  return cardRows.some((candidate) => {
    const candidateTime = Date.parse(candidate.timestamp);
    return (
      candidate.transaction_id !== row.transaction_id &&
      candidate.amount <= 5 &&
      Number.isFinite(candidateTime) &&
      candidateTime < currentTime &&
      currentTime - candidateTime <= 60 * 60 * 1000
    );
  });
}

function severityFromScore(score: number): Severity {
  if (score >= 85) {
    return "Critical";
  }
  if (score >= 70) {
    return "High";
  }
  if (score >= 45) {
    return "Medium";
  }
  return "Low";
}

function topValues(values: Array<string | undefined>, limit: number) {
  return [...frequency(values.filter(Boolean) as string[]).entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([value]) => value);
}

function frequency(values: string[]) {
  return values.reduce<Map<string, number>>((accumulator, value) => {
    accumulator.set(value, (accumulator.get(value) ?? 0) + 1);
    return accumulator;
  }, new Map());
}

function median(values: number[]) {
  if (values.length === 0) {
    return 0;
  }
  const midpoint = Math.floor(values.length / 2);
  return values.length % 2 === 0
    ? ((values[midpoint - 1] ?? 0) + (values[midpoint] ?? 0)) / 2
    : (values[midpoint] ?? 0);
}

function uniqueCount(values: Array<string | undefined>) {
  return new Set(values.filter(Boolean)).size;
}

function isHighRiskCategory(category: string) {
  return highRiskCategories.includes(category.toLowerCase());
}

function roundMoney(value: number) {
  return Number(value.toFixed(2));
}

function readableTime(timestamp: string) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return timestamp.slice(11, 16) || "time";
  }
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function formatMoney(value: number) {
  return new Intl.NumberFormat("en-US", {
    currency: "USD",
    style: "currency",
  }).format(value);
}

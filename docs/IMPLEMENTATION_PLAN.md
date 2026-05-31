# Implementation Plan

## Architecture

```text
transactions.csv
      ↓
Fraud Engine
  - cleaning
  - feature engineering
  - per-card baselines
  - cross-card aggregation
  - scoring rules
  - calibration
      ↓
scored_transactions.csv
      ↓
Reviewer UI
  - queue
  - explanations
  - related activity
  - approve / dismiss / escalate
  - undo
  - audit log
```

## Detection Engine

1. Load and clean transactions.
2. Compute per-card amount and behavior baselines.
3. Compute rare category, country, channel, device, and IP signals.
4. Compute velocity, card-testing, merchant-burst, and category-burst features.
5. Score transactions with explainable rules.
6. Apply low-value dampening and strong-signal gating.
7. Print threshold calibration.
8. Export scored CSV rows.

## Frontend

- CSV upload and scoring flow.
- Dashboard overview.
- One-case-at-a-time review queue.
- Evidence panels for baseline, related activity, timeline, and summary.
- Quick review with arrow keys.
- Approve, dismiss, escalate, undo, and audit log.

## Tradeoffs

We chose explainable rules over supervised ML because no fraud labels are provided. This keeps the system credible for a human-review product and lets judges inspect why a transaction was flagged. The scoring engine can later accept supervised model outputs as an additional feature once confirmed labels exist.

## Engineering Notes

- Scoring is deterministic and reproducible.
- Feature columns are exported for inspection.
- Threshold calibration is printed after each run.
- Regression tests cover normal and fraudulent scenarios.

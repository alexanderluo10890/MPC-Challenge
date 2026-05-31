# FraudFrog

FraudFrog is an explainable fraud triage tool for payment-company reviewers. It combines a modular Python scoring engine with a reviewer UI for CSV upload, evidence review, approve/dismiss/escalate decisions, undo, and audit history.

The goal is not to automatically block every suspicious transaction. The goal is to rank likely fraud, explain each flag, and help a human reviewer make fast, confident decisions.

## How To Run

Backend scoring:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python fraud_detector.py transactions.csv scored_transactions.csv Balanced
```

Frontend reviewer app:

```bash
cd flagly
npm install
npm run dev
```

For a production compile check:

```bash
cd flagly
npm run build
```

## Detection Strategy

Each transaction is scored using:

- per-card amount and behavior baselines
- rare category, country, channel, device, and IP signals
- velocity windows for card activity
- card-testing patterns
- merchant and category burst detection
- shared device/IP activity across cards

## Reliability Safeguards

- Low-value dampening prevents normal subscriptions from becoming High/Critical without a strong pattern.
- CA to US low-value online purchases are treated as weak cross-border signals.
- Rare IP, device, and category signals are contextual instead of blindly additive.
- High and Critical levels require strong fraud patterns, not just stacked weak signals.
- Threshold calibration reports show how many transactions cross score cutoffs.
- Regression tests cover normal transactions, known false-positive patterns, and strong fraud scenarios.

## Reviewer Workflow

Reviewers can:

- review one flagged transaction at a time
- inspect score, severity, reasons, baseline comparison, related activity, and timeline
- approve as legitimate, dismiss the flag, or escalate as likely fraud
- use keyboard shortcuts and quick-review arrows
- undo the last decision
- inspect an audit log

## Why Not Pure ML?

The dataset does not provide labels, so a supervised model would either be trained on guesses or overfit assumptions. FraudFrog uses explainable rules and behavioral features as the source of truth. Unsupervised anomaly detection could be added as a supporting signal later, but every flag should still have concrete reviewer-facing reasons.

## Tests

```bash
.venv/bin/python -m unittest discover -s tests -v
```

Current tests verify:

- low-value Disney+ subscriptions are not High risk
- normal grocery transactions stay Low risk
- high-value gift cards from new identity signals become Critical
- shared IP activity across cards is flagged
- card-testing patterns are escalated
- flagged transactions include explanations

## What We Would Do Next

- train a supervised model once confirmed reviewer labels exist
- add graph-based entity detection across cards, IPs, devices, and merchants
- make all production features strictly backward-looking with persisted historical baselines
- add drift monitoring and threshold recalibration
- expand role-based audit trails and exportable review notes

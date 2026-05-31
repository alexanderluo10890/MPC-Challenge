# Product Requirements Document

## User

Fraud reviewers at a payment company who need to triage suspicious card transactions quickly without blocking normal customers.

## Problem

The company receives too many transactions for manual review. False negatives create fraud loss, while false positives create customer friction and operational waste. Reviewers need ranked cases with clear evidence, not a black-box decision.

## Goals

- Rank suspicious transactions accurately.
- Explain every flag with concrete evidence.
- Reduce false positives from weak, low-value signals.
- Support fast human review with keyboard-friendly workflows.
- Store review decisions in an audit trail.
- Export scored transactions with review status.

## Non-Goals

- FraudFrog does not automatically block transactions.
- FraudFrog does not train a supervised model without labels.
- FraudFrog is not a production authorization gateway.

## Success Metrics

- High F1 on the hidden answer key.
- Flagged rate near the expected fraud rate.
- Every flagged transaction has a reason.
- Reviewers can approve, dismiss, escalate, undo, search, and filter.
- Decisions are visible in the audit log.

## Core Workflow

1. Reviewer uploads a transaction CSV.
2. The scoring engine builds card baselines and cross-card signals.
3. The engine exports scored transactions.
4. Reviewer opens the queue and inspects the highest-risk cases.
5. Reviewer approves, dismisses, or escalates each case.
6. FraudFrog records decisions for audit and export.

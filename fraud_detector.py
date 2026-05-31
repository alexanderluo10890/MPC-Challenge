"""
fraud_detector.py — Feature engineering foundation for a credit card fraud detection engine.

Usage:
    python fraud_detector.py transactions.csv transactions_features.csv
"""

import sys
import pandas as pd
import numpy as np


LOW_RISK_CATEGORIES = {
    "subscription",
    "entertainment",
    "utilities",
    "restaurant",
    "grocery",
}

HIGH_RISK_CATEGORIES = {
    "gift_card",
    "electronics",
    "travel",
    "atm",
    "online_retail",
}


# ─── Loading & Cleaning ───────────────────────────────────────────────────────

def load_transactions(input_path):
    """
    Load transactions from CSV, parse timestamps, sort chronologically,
    and clean missing/invalid values.
    """
    df = pd.read_csv(input_path)

    df['timestamp'] = pd.to_datetime(df['timestamp'])
    df = df.sort_values('timestamp').reset_index(drop=True)

    df['device_id'] = df['device_id'].fillna('').astype(str)
    df['ip_address'] = df['ip_address'].fillna('').astype(str)
    df['merchant_name'] = df['merchant_name'].fillna('').astype(str)
    df['merchant_category'] = df['merchant_category'].fillna('').astype(str)
    df['amount'] = pd.to_numeric(df['amount'], errors='coerce').fillna(0.0)

    return df


# ─── Static Per-Card Features ─────────────────────────────────────────────────

def add_card_baselines(df):
    """
    Compute per-card statistical baselines (median, mean, 95th percentile, diversity counts)
    and merge them back as new columns on every row for that card.
    Also adds amount_ratio_to_median and amount_above_card_95th_percentile.
    """
    card_stats = df.groupby('card_id').agg(
        card_median_amount=('amount', 'median'),
        card_mean_amount=('amount', 'mean'),
        card_95th_percentile_amount=('amount', lambda x: x.quantile(0.95)),
        card_transaction_count=('transaction_id', 'count'),
        card_unique_categories_count=('merchant_category', 'nunique'),
        card_unique_merchants_count=('merchant_name', 'nunique'),
        card_unique_countries_count=('merchant_country', 'nunique'),
        card_unique_channels_count=('channel', 'nunique'),
    ).reset_index()

    df = df.merge(card_stats, on='card_id', how='left')

    # Avoid division by zero: cards with median == 0 get ratio 0.0
    median_safe = df['card_median_amount'].replace(0, np.nan)
    df['amount_ratio_to_median'] = (df['amount'] / median_safe).fillna(0.0)
    df['amount_above_card_95th_percentile'] = df['amount'] > df['card_95th_percentile_amount']

    return df


def add_frequency_features(df):
    """
    Count how many times each card used each category, merchant, country, and channel
    across the full dataset. Adds rare-behavior boolean flags for first/only usage per card.
    """
    count_cols = [
        ('merchant_category', 'category_count_for_card'),
        ('merchant_name',     'merchant_count_for_card'),
        ('merchant_country',  'country_count_for_card'),
        ('channel',           'channel_count_for_card'),
    ]

    for value_col, count_col in count_cols:
        df[count_col] = df.groupby(['card_id', value_col])['transaction_id'].transform('count')

    df['is_rare_category_for_card'] = df['category_count_for_card'] <= 1
    df['is_rare_merchant_for_card'] = df['merchant_count_for_card'] <= 1
    df['is_rare_country_for_card']  = df['country_count_for_card'] <= 1
    df['is_rare_channel_for_card']  = df['channel_count_for_card'] <= 1

    return df


def add_online_identity_features(df):
    """
    For online transactions with a non-blank device_id or ip_address, count how many
    times the same card used that device/IP. Flags first/only usage as rare.
    Non-online rows and blank identifiers default to 0 / False.
    """
    is_online  = df['channel'].str.lower() == 'online'
    has_device = is_online & (df['device_id'] != '')
    has_ip     = is_online & (df['ip_address'] != '')

    df['device_count_for_card']   = 0
    df['ip_count_for_card']       = 0
    df['is_rare_device_for_card'] = False
    df['is_rare_ip_for_card']     = False

    if has_device.any():
        device_counts = (
            df[has_device]
            .groupby(['card_id', 'device_id'])['transaction_id']
            .transform('count')
        )
        df.loc[has_device, 'device_count_for_card']   = device_counts
        df.loc[has_device, 'is_rare_device_for_card'] = device_counts <= 1

    if has_ip.any():
        ip_counts = (
            df[has_ip]
            .groupby(['card_id', 'ip_address'])['transaction_id']
            .transform('count')
        )
        df.loc[has_ip, 'ip_count_for_card']   = ip_counts
        df.loc[has_ip, 'is_rare_ip_for_card'] = ip_counts <= 1

    return df


def add_cross_card_features(df):
    """
    Compute how many unique cards share each device, IP, merchant, and category.
    Blank device_id/ip_address are excluded from sharing counts and assigned 0.
    Adds boolean flags for identifiers shared across multiple cards — useful signals
    for carding rings and account-takeover patterns.
    """
    has_device = df['device_id'] != ''
    has_ip     = df['ip_address'] != ''

    df['device_unique_cards'] = 0
    df['ip_unique_cards']     = 0

    if has_device.any():
        df.loc[has_device, 'device_unique_cards'] = (
            df[has_device].groupby('device_id')['card_id'].transform('nunique')
        )

    if has_ip.any():
        df.loc[has_ip, 'ip_unique_cards'] = (
            df[has_ip].groupby('ip_address')['card_id'].transform('nunique')
        )

    df['merchant_unique_cards'] = df.groupby('merchant_name')['card_id'].transform('nunique')
    df['category_unique_cards'] = df.groupby('merchant_category')['card_id'].transform('nunique')

    df['device_shared_across_cards']  = df['device_unique_cards'] >= 2
    df['ip_shared_across_cards']      = df['ip_unique_cards'] >= 2
    df['merchant_used_by_many_cards'] = df['merchant_unique_cards'] >= 3

    return df


# ─── Time-Window Features ─────────────────────────────────────────────────────

def add_velocity_features(df):
    """
    For each transaction, count activity by the same card within recent time windows.
    Windows are backward-looking and inclusive of the current transaction's timestamp.
    Readable row-by-row approach is fine for datasets up to a few thousand rows.
    """
    df['card_txn_count_30min']        = 0
    df['card_txn_count_1h']           = 0
    df['card_online_txn_count_30min'] = 0
    df['card_unique_merchants_30min'] = 0

    td_30min = pd.Timedelta(minutes=30)
    td_1h    = pd.Timedelta(hours=1)

    for _card_id, group in df.groupby('card_id'):
        ts        = group['timestamp']
        is_online = group['channel'].str.lower() == 'online'
        merchants = group['merchant_name']

        for idx, row in group.iterrows():
            t        = row['timestamp']
            in_30min = (ts >= t - td_30min) & (ts <= t)
            in_1h    = (ts >= t - td_1h) & (ts <= t)

            df.at[idx, 'card_txn_count_30min']        = int(in_30min.sum())
            df.at[idx, 'card_txn_count_1h']           = int(in_1h.sum())
            df.at[idx, 'card_online_txn_count_30min'] = int((in_30min & is_online).sum())
            df.at[idx, 'card_unique_merchants_30min'] = int(merchants[in_30min].nunique())

    return df


def add_card_testing_features(df):
    """
    Identify small/large transactions and detect potential card-testing patterns:
    fraudsters often run a small probe transaction to verify a card is live before
    making a larger fraudulent purchase.

    is_small_transaction      : amount <= 5
    is_large_transaction      : amount >= 500 OR amount_ratio_to_median >= 5
    had_small_txn_before_large: backward window — was the card probed before this large charge?
    has_large_txn_after_small : forward window  — does a probe here precede a large charge?

    Requires amount_ratio_to_median (added by add_card_baselines).
    """
    # Small: absolute threshold OR below 50% of the card's typical spend.
    # The relative clause catches low-spend cards whose test charges exceed $15.
    df['is_small_transaction'] = (
        (df['amount'] <= 15) |
        (df['amount'] <= 0.5 * df['card_median_amount'])
    )
    df['is_large_transaction'] = (df['amount'] >= 500) | (df['amount_ratio_to_median'] >= 5)

    df['small_txn_count_1h_for_card']      = 0
    df['had_small_txn_before_large_2h']    = False
    df['has_large_txn_after_small_2h']     = False

    td_1h = pd.Timedelta(hours=1)
    td_2h = pd.Timedelta(hours=2)

    for _card_id, group in df.groupby('card_id'):
        ts       = group['timestamp']
        is_small = group['is_small_transaction']
        is_large = group['is_large_transaction']

        for idx, row in group.iterrows():
            t           = row['timestamp']
            in_1h_back  = (ts >= t - td_1h) & (ts <= t)
            in_2h_back  = (ts >= t - td_2h) & (ts <= t)
            in_2h_fwd   = (ts > t) & (ts <= t + td_2h)

            df.at[idx, 'small_txn_count_1h_for_card'] = int((in_1h_back & is_small).sum())

            if row['is_large_transaction']:
                df.at[idx, 'had_small_txn_before_large_2h'] = bool((in_2h_back & is_small).any())

            if row['is_small_transaction']:
                df.at[idx, 'has_large_txn_after_small_2h'] = bool((in_2h_fwd & is_large).any())

    return df


def add_merchant_burst_features(df):
    """
    For each transaction, count unusual activity at the same merchant in recent windows.
    A sudden spike in unique cards or high-value transactions at one merchant can indicate
    a compromised merchant or coordinated fraud.

    high-value: amount >= 500 OR amount_ratio_to_median >= 5
    Requires amount_ratio_to_median (added by add_card_baselines).
    """
    df['merchant_unique_cards_1h']        = 0
    df['merchant_unique_cards_2h']        = 0
    df['merchant_high_value_txn_count_2h'] = 0

    is_high_value = (df['amount'] >= 500) | (df['amount_ratio_to_median'] >= 5)

    td_1h = pd.Timedelta(hours=1)
    td_2h = pd.Timedelta(hours=2)

    for _merchant, group in df.groupby('merchant_name'):
        ts       = group['timestamp']
        cards    = group['card_id']
        high_val = is_high_value[group.index]

        for idx, row in group.iterrows():
            t     = row['timestamp']
            in_1h = (ts >= t - td_1h) & (ts <= t)
            in_2h = (ts >= t - td_2h) & (ts <= t)

            df.at[idx, 'merchant_unique_cards_1h']         = int(cards[in_1h].nunique())
            df.at[idx, 'merchant_unique_cards_2h']         = int(cards[in_2h].nunique())
            df.at[idx, 'merchant_high_value_txn_count_2h'] = int((in_2h & high_val).sum())

    return df


def add_category_burst_features(df):
    """
    Flag high-risk category patterns:
    - Repeated gift card or electronics purchases per card within 24 hours
      (common money-laundering and resale patterns).
    - Unusual spikes in unique cards per category within 2 hours
      (may indicate a coordinated attack on a category).
    """
    df['card_gift_card_count_24h']   = 0
    df['card_electronics_count_24h'] = 0
    df['category_unique_cards_2h']   = 0

    td_24h = pd.Timedelta(hours=24)
    td_2h  = pd.Timedelta(hours=2)

    for _card_id, group in df.groupby('card_id'):
        ts   = group['timestamp']
        cats = group['merchant_category']

        for idx, row in group.iterrows():
            t      = row['timestamp']
            in_24h = (ts >= t - td_24h) & (ts <= t)

            df.at[idx, 'card_gift_card_count_24h']   = int(((cats == 'gift_card') & in_24h).sum())
            df.at[idx, 'card_electronics_count_24h'] = int(((cats == 'electronics') & in_24h).sum())

    for _category, group in df.groupby('merchant_category'):
        ts    = group['timestamp']
        cards = group['card_id']

        for idx, row in group.iterrows():
            t     = row['timestamp']
            in_2h = (ts >= t - td_2h) & (ts <= t)
            df.at[idx, 'category_unique_cards_2h'] = int(cards[in_2h].nunique())

    return df


def add_inactivity_features(df):
    """
    Compute the time gap since each card's previous transaction.
    A transaction following a long dormancy period (> 7 days) can signal
    account takeover or a stolen card being used after a delay.
    First transaction per card has NaN for hours_since_previous_card_transaction.
    """
    prev_ts = df.groupby('card_id')['timestamp'].shift(1)

    df['hours_since_previous_card_transaction'] = (
        (df['timestamp'] - prev_ts).dt.total_seconds() / 3600
    )
    df['after_7_days_inactivity'] = (
        df['hours_since_previous_card_transaction'] > 7 * 24
    ).fillna(False)

    return df


# ─── Fraud Scoring ────────────────────────────────────────────────────────────

def add_fraud_scores(df):
    """
    Rule-based explainable fraud scoring engine. All rules are additive; the final
    risk_score is capped at 100. Adds:
      risk_score, risk_level, flag_status, recommended_action, major_signal_count,
      fraud_reasons, fraud_pattern, reviewer_decision, reviewer_notes.

    Requires all upstream feature engineering columns to be present.
    """
    risk_scores, risk_levels, flag_statuses = [], [], []
    actions, signal_counts, all_reasons, patterns = [], [], [], []

    for _, row in df.iterrows():
        score   = 0
        reasons = []

        # Frequently referenced scalars
        amount_ratio  = float(row['amount_ratio_to_median'])
        amount        = float(row['amount'])
        channel       = str(row['channel']).lower()
        category      = str(row['merchant_category']).lower()
        hour          = row['timestamp'].hour
        card_total    = int(row['card_transaction_count'])
        channel_count = int(row['channel_count_for_card'])
        device_unique = int(row['device_unique_cards'])
        ip_unique     = int(row['ip_unique_cards'])
        txn_30min     = int(row['card_txn_count_30min'])
        txn_1h        = int(row['card_txn_count_1h'])
        online_30min  = int(row['card_online_txn_count_30min'])
        merch_30min   = int(row['card_unique_merchants_30min'])
        merch_1h      = int(row['merchant_unique_cards_1h'])
        merch_2h      = int(row['merchant_unique_cards_2h'])
        high_val_2h   = int(row['merchant_high_value_txn_count_2h'])
        small_1h      = int(row['small_txn_count_1h_for_card'])
        gift_24h      = int(row['card_gift_card_count_24h'])
        elec_24h      = int(row['card_electronics_count_24h'])
        is_common_cross_border_online = (
            channel == "online"
            and row["cardholder_country"] == "CA"
            and row["merchant_country"] == "US"
        )

        strong_signal_count = sum([
            amount_ratio >= 5,
            device_unique >= 2,
            ip_unique >= 2,
            txn_30min >= 3,
            txn_1h >= 5,
            online_30min >= 3,
            merch_30min >= 3,
            small_1h >= 3,
            bool(row['had_small_txn_before_large_2h']),
            bool(row['has_large_txn_after_small_2h']),
            merch_1h >= 3,
            merch_2h >= 5,
            high_val_2h >= 3,
            gift_24h >= 2,
            elec_24h >= 2,
            category == "gift_card" and amount >= 500,
        ])

        # ── Amount anomaly ───────────────────────────────────────────────
        if amount_ratio >= 10:
            score += 30
            reasons.append(
                f"Amount is {amount_ratio:.1f}x higher than this card's median transaction"
            )
        elif amount_ratio >= 5:
            score += 20
            reasons.append(
                f"Amount is {amount_ratio:.1f}x higher than this card's median transaction"
            )
        elif amount_ratio >= 3:
            score += 10
            reasons.append(
                f"Amount is {amount_ratio:.1f}x higher than this card's median transaction"
            )

        if row['amount_above_card_95th_percentile']:
            score += 10
            reasons.append("Amount exceeds this card's 95th percentile")

        # ── Category ─────────────────────────────────────────────────────
        if row['is_rare_category_for_card']:
            if category in LOW_RISK_CATEGORIES and amount < 50:
                score += 3
                reasons.append("Category is uncommon for this card, but low-risk and low-value")
            elif category in HIGH_RISK_CATEGORIES:
                score += 15
                reasons.append("Merchant category is rare and higher-risk for this card")
            else:
                score += 8
                reasons.append("Merchant category is rare for this card")

        if category == 'gift_card':
            score += 15
            reasons.append("Transaction is a high-risk gift card purchase")

        if category == 'electronics':
            score += 10
            reasons.append("Transaction is an electronics purchase")

        if category == 'travel' and amount_ratio >= 5:
            score += 10
            reasons.append("High-value travel transaction for this card")

        # Bonus: high-risk category + high amount
        if category in ('gift_card', 'electronics', 'travel', 'atm', 'online_retail') \
                and amount_ratio >= 5:
            score += 10
            reasons.append(
                f"High-value {category} transaction is 5x+ the card median"
            )

        # ── Country ──────────────────────────────────────────────────────
        if row['merchant_country'] != row['cardholder_country']:
            if is_common_cross_border_online and amount < 100:
                score += 3
                reasons.append("US online merchant for Canadian cardholder; weak signal")
            else:
                score += 10
                reasons.append(
                    f"Merchant country ({row['merchant_country']}) differs from "
                    f"cardholder country ({row['cardholder_country']})"
                )

        if row['is_rare_country_for_card']:
            score += 15
            reasons.append("Merchant country is rare for this card")

        if row['is_rare_country_for_card'] and amount_ratio >= 5:
            score += 10
            reasons.append("High-value transaction in a rarely-used country for this card")

        # ── Channel ──────────────────────────────────────────────────────
        if row['is_rare_channel_for_card']:
            score += 10
            reasons.append("Transaction channel is rare for this card")

        # Online transaction on a card that primarily uses in-person channels
        if channel == 'online' and card_total > 0 and (channel_count / card_total) < 0.4:
            score += 15
            reasons.append("Online transaction on a card that primarily uses in-person channels")

        if channel == 'atm' and row['is_rare_channel_for_card']:
            score += 15
            reasons.append("ATM transaction on a card that rarely uses ATMs")

        # ── Device / IP ───────────────────────────────────────────────────
        if row['is_rare_device_for_card']:
            if amount_ratio >= 5 or amount >= 100 or ip_unique >= 2:
                score += 15
                reasons.append("Device is rare for this card")
            else:
                score += 5
                reasons.append("Device is rare for this card, but transaction value is low")

        if row['is_rare_ip_for_card']:
            if amount_ratio >= 5 or amount >= 100 or device_unique >= 2:
                score += 15
                reasons.append("IP address is rare for this card")
            else:
                score += 5
                reasons.append("IP address is rare for this card, but transaction value is low")

        # Bonus: both device and IP are new
        if row['is_rare_device_for_card'] and row['is_rare_ip_for_card']:
            score += 10
            reasons.append("Both device and IP address are new for this card")

        # ── Shared device / IP ────────────────────────────────────────────
        if device_unique >= 3:
            score += 25
            reasons.append(f"Device used by {device_unique} different cards")
        elif device_unique == 2:
            score += 15
            reasons.append("Device shared with at least one other card")

        if ip_unique >= 3:
            score += 25
            reasons.append(f"IP address used by {ip_unique} different cards")
        elif ip_unique == 2:
            score += 15
            reasons.append("IP address shared with at least one other card")

        # ── Velocity ──────────────────────────────────────────────────────
        if txn_1h >= 5:
            score += 25
            reasons.append(f"This card made {txn_1h} transactions within 1 hour")

        if txn_30min >= 3:
            score += 15
            reasons.append(f"This card made {txn_30min} transactions within 30 minutes")

        if online_30min >= 3:
            score += 10
            reasons.append(f"This card made {online_30min} online transactions within 30 minutes")

        if merch_30min >= 3:
            score += 10
            reasons.append(
                f"This card used {merch_30min} different merchants within 30 minutes"
            )

        # ── Card testing ──────────────────────────────────────────────────
        if row['had_small_txn_before_large_2h']:
            score += 30
            reasons.append(
                "This transaction follows small test charges within the previous 2 hours"
            )

        if row['has_large_txn_after_small_2h']:
            score += 20
            reasons.append(
                "This small transaction precedes a large charge within the next 2 hours"
            )

        if small_1h >= 3:
            score += 25
            reasons.append(
                f"This card made {small_1h} small probe transactions within 1 hour"
            )

        # ── Merchant burst ────────────────────────────────────────────────
        if merch_2h >= 5:
            score += 30
            reasons.append(f"Multiple cards ({merch_2h}) used this merchant within 2 hours")

        if merch_1h >= 3:
            score += 20
            reasons.append(f"Multiple cards ({merch_1h}) used this merchant within 1 hour")

        if high_val_2h >= 3:
            score += 25
            reasons.append(
                f"{high_val_2h} high-value transactions at this merchant within 2 hours"
            )

        # ── Category burst ────────────────────────────────────────────────
        if gift_24h >= 2:
            score += 25
            reasons.append(
                f"This card made {gift_24h} gift card purchases within 24 hours"
            )

        if elec_24h >= 2:
            score += 20
            reasons.append(
                f"This card made {elec_24h} electronics purchases within 24 hours"
            )

        # High-value gift card from a new device or IP — strong laundering signal
        if category == 'gift_card' and amount >= 500 \
                and (row['is_rare_device_for_card'] or row['is_rare_ip_for_card']):
            score += 30
            reasons.append("High-value gift card purchase from a new device or IP address")

        # ── Time ──────────────────────────────────────────────────────────
        if hour >= 22 or hour <= 5:
            score += 5
            reasons.append(f"Transaction occurred at an unusual hour ({hour:02d}:xx)")

        if row['after_7_days_inactivity']:
            score += 10
            reasons.append("Transaction follows more than 7 days of card inactivity")

        # ── Apply sensitivity multiplier and final score ────────────────
        # Sensitivity can be provided via global SENSITIVITY_MULTIPLIER mapping
        multiplier = globals().get("_SENSITIVITY_MULTIPLIER", 1.0)
        try:
            score = float(score) * float(multiplier)
        except Exception:
            score = float(score)

        # Low-value transactions should not become High/Critical unless they
        # connect to a stronger fraud pattern.
        if amount < 25 and strong_signal_count == 0:
            score = min(score, 35)
            reasons.append("Low-value transaction: risk reduced because no strong fraud pattern was found")
        elif amount < 50 and strong_signal_count == 0:
            score = min(score, 45)
            reasons.append("Low-value transaction: capped because signals are weak")

        score = int(min(100, round(score)))
        major_signals = int(strong_signal_count)

        # ── Risk level ────────────────────────────────────────────────────
        if score >= 85 and strong_signal_count >= 2:
            risk_level = 'Critical'
        elif score >= 70 and strong_signal_count >= 1:
            risk_level = 'High'
        elif score >= 40:
            risk_level = 'Medium'
        else:
            risk_level = 'Low'

        # ── Flag status + recommended action ──────────────────────────────
        if risk_level == 'Critical':
            flag_status = 'Flagged'
            action = 'Escalate'
        elif risk_level == 'High':
            flag_status = 'Flagged'
            action = 'Review'
        elif risk_level == 'Medium':
            flag_status = 'Watchlist'
            action = 'Watchlist'
        else:
            flag_status = 'Not Flagged'
            action = 'No Action'

        # ── Fraud pattern (priority order) ────────────────────────────────
        if device_unique >= 2 or ip_unique >= 2:
            pattern = 'Shared Device/IP Attack'
        elif (row['had_small_txn_before_large_2h']
              or row['has_large_txn_after_small_2h']
              or small_1h >= 3):
            pattern = 'Card Testing'
        elif category == 'gift_card' or gift_24h >= 2:
            pattern = 'Gift Card Burst'
        elif merch_1h >= 3 or merch_2h >= 5:
            pattern = 'Merchant Burst'
        elif amount_ratio >= 10:
            pattern = 'Amount Outlier'
        elif (row['merchant_country'] != row['cardholder_country']
              and channel == 'online'):
            pattern = 'Foreign Online Purchase'
        else:
            pattern = 'Unusual Card Behavior'

        # For high-risk transactions that fell through to the generic pattern,
        # assign a more specific fallback based on the strongest signal present.
        if risk_level == 'Critical' and pattern == 'Unusual Card Behavior':
            if amount_ratio >= 10:
                pattern = 'Amount Outlier'
            elif merch_1h >= 3 or merch_2h >= 5:
                pattern = 'Merchant Burst'
            elif txn_30min >= 3 or txn_1h >= 5:
                pattern = 'Card Testing'
            elif (row['merchant_country'] != row['cardholder_country']
                  and channel == 'online'):
                pattern = 'Foreign Online Purchase'
            else:
                pattern = 'High-Risk Anomaly'

        risk_scores.append(score)
        risk_levels.append(risk_level)
        flag_statuses.append(flag_status)
        actions.append(action)
        signal_counts.append(major_signals)
        all_reasons.append('; '.join(reasons) if reasons else '')
        patterns.append(pattern)

    df['risk_score']         = risk_scores
    df['risk_level']         = risk_levels
    df['flag_status']        = flag_statuses
    df['recommended_action'] = actions
    df['major_signal_count'] = signal_counts
    df['fraud_reasons']      = all_reasons
    df['fraud_pattern']      = patterns
    df['reviewer_decision']  = 'Pending'
    df['reviewer_notes']     = ''

    return df


def print_threshold_report(df):
    """
    Print score cutoffs so the reviewer queue can be calibrated against the
    expected fraud rate. The challenge data is roughly 7% fraud, so Balanced
    mode should usually keep Score >= 70 near the high single digits.
    """
    print("\n--- Threshold Calibration ---")
    for threshold in [30, 40, 50, 60, 70, 80, 85, 90]:
        flagged = int((df["risk_score"] >= threshold).sum())
        pct = flagged / len(df) * 100 if len(df) else 0
        print(f"  Score >= {threshold}: {flagged:,} transactions ({pct:.1f}%)")


# ─── Pipeline ─────────────────────────────────────────────────────────────────

def build_features(input_path, output_path):
    """
    Full feature engineering pipeline: load and clean data, run all enrichment steps,
    export the result to CSV, and print a summary report.
    """
    print(f"Loading transactions from: {input_path}")
    df = load_transactions(input_path)

    print("Adding card baseline features...")
    df = add_card_baselines(df)

    print("Adding frequency features...")
    df = add_frequency_features(df)

    print("Adding online identity features...")
    df = add_online_identity_features(df)

    print("Adding cross-card features...")
    df = add_cross_card_features(df)

    print("Adding velocity features...")
    df = add_velocity_features(df)

    print("Adding card testing features...")
    df = add_card_testing_features(df)

    print("Adding merchant burst features...")
    df = add_merchant_burst_features(df)

    print("Adding category burst features...")
    df = add_category_burst_features(df)

    print("Adding inactivity features...")
    df = add_inactivity_features(df)

    print("Scoring transactions...")
    # Allow an optional sensitivity parameter via global variable set by caller
    df = add_fraud_scores(df)

    df.to_csv(output_path, index=False)

    # ── Summary ──────────────────────────────────────────────────────────────
    n_transactions = len(df)
    n_cards        = df['card_id'].nunique()
    n_online       = (df['channel'].str.lower() == 'online').sum()
    n_merchants    = df['merchant_name'].nunique()

    n_shared_devices = int(
        df[df['device_id'] != '']
        .groupby('device_id')['card_id']
        .nunique()
        .ge(2)
        .sum()
    ) if (df['device_id'] != '').any() else 0

    n_shared_ips = int(
        df[df['ip_address'] != '']
        .groupby('ip_address')['card_id']
        .nunique()
        .ge(2)
        .sum()
    ) if (df['ip_address'] != '').any() else 0

    n_low      = int((df['risk_level'] == 'Low').sum())
    n_medium   = int((df['risk_level'] == 'Medium').sum())
    n_high     = int((df['risk_level'] == 'High').sum())
    n_critical = int((df['risk_level'] == 'Critical').sum())
    n_flagged  = int((df['flag_status'] == 'Flagged').sum())
    n_watchlist = int((df['flag_status'] == 'Watchlist').sum())

    print("\n--- Summary ---")
    print(f"  Transactions:                              {n_transactions:,}")
    print(f"  Unique cards:                              {n_cards:,}")
    print(f"  Online transactions:                       {n_online:,}")
    print(f"  Unique merchants:                          {n_merchants:,}")
    print(f"  Shared devices (>= 2 cards):               {n_shared_devices:,}")
    print(f"  Shared IPs (>= 2 cards):                   {n_shared_ips:,}")
    print(f"  Max card_txn_count_30min:                  {int(df['card_txn_count_30min'].max()):,}")
    print(f"  Max card_txn_count_1h:                     {int(df['card_txn_count_1h'].max()):,}")
    print(f"  Max merchant_unique_cards_1h:              {int(df['merchant_unique_cards_1h'].max()):,}")
    print(f"  Max merchant_unique_cards_2h:              {int(df['merchant_unique_cards_2h'].max()):,}")
    print(f"  Txns: had_small_txn_before_large_2h=True:  {int(df['had_small_txn_before_large_2h'].sum()):,}")
    print(f"  Txns: has_large_txn_after_small_2h=True:   {int(df['has_large_txn_after_small_2h'].sum()):,}")
    print(f"  Txns: merchant_unique_cards_1h >= 3:        {int((df['merchant_unique_cards_1h'] >= 3).sum()):,}")
    print(f"  Txns: merchant_unique_cards_2h >= 5:        {int((df['merchant_unique_cards_2h'] >= 5).sum()):,}")

    print(f"  Small transactions (new def):              {int(df['is_small_transaction'].sum()):,}")
    print(f"  Large transactions:                        {int(df['is_large_transaction'].sum()):,}")
    print(f"  Txns: small_txn_count_1h_for_card >= 3:    {int((df['small_txn_count_1h_for_card'] >= 3).sum()):,}")
    print(f"  Txns: had_small_txn_before_large_2h=True:  {int(df['had_small_txn_before_large_2h'].sum()):,}")
    print(f"  Txns: has_large_txn_after_small_2h=True:   {int(df['has_large_txn_after_small_2h'].sum()):,}")

    n_high_not_flagged = int(
        ((df['risk_score'] >= 85) & (df['flag_status'] != 'Flagged')).sum()
    )

    print("\n--- Risk Distribution ---")
    print(f"  Low risk transactions:                     {n_low:,}")
    print(f"  Medium risk transactions:                  {n_medium:,}")
    print(f"  High risk transactions:                    {n_high:,}")
    print(f"  Critical risk transactions:                {n_critical:,}")
    print(f"  Score >= 85 but NOT Flagged:               {n_high_not_flagged:,}")
    print(f"  Flagged transactions:                      {n_flagged:,}")
    print(f"  Watchlist transactions:                    {n_watchlist:,}")
    print(f"  Flagged + Watchlist:                       {n_flagged + n_watchlist:,}")

    print_threshold_report(df)

    print("\n--- Top 15 Highest-Risk Transactions ---")
    top15 = df.nlargest(15, 'risk_score')[
        ['transaction_id', 'risk_score', 'flag_status',
         'recommended_action', 'major_signal_count', 'fraud_pattern']
    ]
    for rank, (_, tx) in enumerate(top15.iterrows(), 1):
        print(f"  {rank:2}. {tx['transaction_id']}  |  Score: {tx['risk_score']}  "
              f"|  {tx['flag_status']} / {tx['recommended_action']}  "
              f"|  Signals: {tx['major_signal_count']}  "
              f"|  Pattern: {tx['fraud_pattern']}")

    print(f"\n  Output file: {output_path}")

    return df


if __name__ == '__main__':
    if len(sys.argv) < 3:
        print("Usage: python fraud_detector.py <input.csv> <output.csv> [sensitivity]")
        sys.exit(1)

    sensitivity = sys.argv[3] if len(sys.argv) >= 4 else "Balanced"
    # Sensitivity maps to a multiplier applied to the computed rule score.
    mapping = {
        "Conservative": 0.85,
        "Balanced": 1.0,
        "Aggressive": 1.15,
    }
    # Expose multiplier via a module-global so add_fraud_scores can access it
    globals()['_SENSITIVITY_MULTIPLIER'] = mapping.get(sensitivity, 1.0)

    build_features(input_path=sys.argv[1], output_path=sys.argv[2])

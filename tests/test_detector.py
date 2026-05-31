import unittest

import pandas as pd

import fraud_detector as detector


def tx(
    transaction_id,
    timestamp,
    card_id,
    amount,
    merchant_name,
    merchant_category,
    channel="in_person",
    cardholder_country="US",
    merchant_country="US",
    device_id="",
    ip_address="",
):
    return {
        "transaction_id": transaction_id,
        "timestamp": timestamp,
        "card_id": card_id,
        "amount": amount,
        "merchant_name": merchant_name,
        "merchant_category": merchant_category,
        "channel": channel,
        "cardholder_country": cardholder_country,
        "merchant_country": merchant_country,
        "device_id": device_id,
        "ip_address": ip_address,
    }


def score_rows(rows):
    detector._SENSITIVITY_MULTIPLIER = 1.0
    df = pd.DataFrame(rows)
    df["timestamp"] = pd.to_datetime(df["timestamp"])
    df = df.sort_values("timestamp").reset_index(drop=True)
    df["device_id"] = df["device_id"].fillna("").astype(str)
    df["ip_address"] = df["ip_address"].fillna("").astype(str)
    df["merchant_name"] = df["merchant_name"].fillna("").astype(str)
    df["merchant_category"] = df["merchant_category"].fillna("").astype(str)
    df["amount"] = pd.to_numeric(df["amount"], errors="coerce").fillna(0.0)

    for enrich in [
        detector.add_card_baselines,
        detector.add_frequency_features,
        detector.add_online_identity_features,
        detector.add_cross_card_features,
        detector.add_velocity_features,
        detector.add_card_testing_features,
        detector.add_merchant_burst_features,
        detector.add_category_burst_features,
        detector.add_inactivity_features,
        detector.add_fraud_scores,
    ]:
        df = enrich(df)

    return df


class FraudDetectorTests(unittest.TestCase):
    def test_low_value_subscription_is_not_high_risk(self):
        rows = [
            tx(f"base_{i}", f"2026-04-01T09:{i:02d}:00", "card_sub", 32 + i, "Local Grocer", "grocery")
            for i in range(6)
        ]
        rows.append(
            tx(
                "tx_disney",
                "2026-04-02T11:00:00",
                "card_sub",
                15.99,
                "Disney+",
                "subscription",
                "online",
                "CA",
                "US",
                "dev_new",
                "203.0.113.10",
            )
        )

        scored = score_rows(rows)
        disney = scored.loc[scored["transaction_id"] == "tx_disney"].iloc[0]

        self.assertEqual(disney["risk_level"], "Low")
        self.assertEqual(disney["flag_status"], "Not Flagged")
        self.assertLess(disney["risk_score"], 40)

    def test_normal_grocery_transaction_is_low_risk(self):
        rows = [
            tx(f"grocery_{i}", f"2026-04-{3 + i:02d}T10:00:00", "card_grocery", 38 + i, "Fresh Market", "grocery")
            for i in range(8)
        ]

        scored = score_rows(rows)

        self.assertTrue((scored["risk_level"] == "Low").all())
        self.assertTrue((scored["flag_status"] == "Not Flagged").all())

    def test_high_value_gift_card_new_ip_is_critical(self):
        rows = [
            tx(f"base_gift_{i}", f"2026-04-04T09:{i:02d}:00", "card_gift", 35 + i, "Corner Store", "grocery")
            for i in range(6)
        ]
        rows.append(
            tx(
                "tx_gift_critical",
                "2026-04-05T12:00:00",
                "card_gift",
                750,
                "GiftCardMall",
                "gift_card",
                "online",
                "US",
                "US",
                "dev_gift_new",
                "198.51.100.44",
            )
        )

        scored = score_rows(rows)
        gift = scored.loc[scored["transaction_id"] == "tx_gift_critical"].iloc[0]

        self.assertEqual(gift["risk_level"], "Critical")
        self.assertEqual(gift["flag_status"], "Flagged")
        self.assertEqual(gift["recommended_action"], "Escalate")
        self.assertGreaterEqual(gift["major_signal_count"], 2)

    def test_shared_ip_across_cards_is_flagged(self):
        rows = []
        for card_index in range(3):
            card_id = f"card_shared_{card_index}"
            for i in range(4):
                rows.append(
                    tx(
                        f"shared_base_{card_index}_{i}",
                        f"2026-04-06T08:{card_index}{i}:00",
                        card_id,
                        30 + i,
                        f"Grocer {card_index}",
                        "grocery",
                    )
                )
            rows.append(
                tx(
                    f"tx_shared_ip_{card_index}",
                    f"2026-04-06T10:{card_index}0:00",
                    card_id,
                    120,
                    f"Online Shop {card_index}",
                    "online_retail",
                    "online",
                    "US",
                    "US",
                    "",
                    "192.0.2.77",
                )
            )

        scored = score_rows(rows)
        shared = scored[scored["transaction_id"].str.startswith("tx_shared_ip_")]

        self.assertTrue((shared["flag_status"] == "Flagged").all())
        self.assertTrue(shared["risk_level"].isin(["High", "Critical"]).all())
        self.assertTrue((shared["major_signal_count"] >= 1).all())

    def test_card_testing_pattern_is_critical(self):
        rows = [
            tx("test_probe_1", "2026-04-07T13:00:00", "card_probe", 2.25, "Probe A", "online_retail", "online", device_id="dev_probe", ip_address="203.0.113.80"),
            tx("test_probe_2", "2026-04-07T13:10:00", "card_probe", 3.10, "Probe B", "online_retail", "online", device_id="dev_probe", ip_address="203.0.113.80"),
            tx("test_probe_3", "2026-04-07T13:20:00", "card_probe", 4.20, "Probe C", "online_retail", "online", device_id="dev_probe", ip_address="203.0.113.80"),
            tx("test_large", "2026-04-07T13:45:00", "card_probe", 820, "Luxury Electronics", "electronics", "online", device_id="dev_probe", ip_address="203.0.113.80"),
        ]

        scored = score_rows(rows)
        large = scored.loc[scored["transaction_id"] == "test_large"].iloc[0]

        self.assertEqual(large["risk_level"], "Critical")
        self.assertEqual(large["flag_status"], "Flagged")
        self.assertIn("small test charges", large["fraud_reasons"])

    def test_card_testing_burst_flags_opening_probe(self):
        # A pure card-testing burst: many tiny online charges in minutes, with no
        # large purchase afterward. A backward-only window misses the opening
        # probes (they score ~0 because nothing precedes them); the symmetric
        # burst window must flag every transaction in the burst, including the first.
        rows = [
            tx(f"steady_{i}", f"2026-04-09T09:{i:02d}:00", "card_burst", 40 + i, "Fresh Market", "grocery")
            for i in range(8)
        ]
        probe_times = ["13:00:00", "13:02:30", "13:04:10", "13:05:00",
                       "13:06:40", "13:08:15", "13:09:50", "13:11:20"]
        for i, t in enumerate(probe_times):
            rows.append(
                tx(f"burst_probe_{i}", f"2026-04-10T{t}", "card_burst", 2.0 + i * 0.5,
                   f"Probe Shop {i}", "online_retail", "online",
                   device_id="dev_burst", ip_address="203.0.113.200")
            )

        scored = score_rows(rows)
        first_probe = scored.loc[scored["transaction_id"] == "burst_probe_0"].iloc[0]
        probes = scored[scored["transaction_id"].str.startswith("burst_probe_")]

        # The opening probe is no longer missed.
        self.assertGreaterEqual(first_probe["risk_score"], 60)
        self.assertEqual(first_probe["fraud_pattern"], "Card Testing")
        # Every probe in the burst is flagged at the Balanced threshold (60).
        self.assertTrue((probes["risk_score"] >= 60).all())

    def test_flagged_transactions_have_reasons(self):
        rows = [
            tx(f"base_reason_{i}", f"2026-04-08T09:{i:02d}:00", "card_reason", 30 + i, "Local Grocer", "grocery")
            for i in range(5)
        ]
        rows.append(
            tx(
                "tx_reason_flagged",
                "2026-04-08T12:00:00",
                "card_reason",
                900,
                "GiftCardMall",
                "gift_card",
                "online",
                "US",
                "US",
                "dev_reason_new",
                "198.51.100.99",
            )
        )

        scored = score_rows(rows)
        flagged = scored[scored["flag_status"] == "Flagged"]

        self.assertFalse(flagged.empty)
        self.assertTrue(flagged["fraud_reasons"].str.len().gt(0).all())


if __name__ == "__main__":
    unittest.main()

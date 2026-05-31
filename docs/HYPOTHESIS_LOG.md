# Hypothesis Log

| Hypothesis | Signal | Result | Decision |
|---|---|---|---|
| Fraudsters test cards with small purchases before large ones | `small_txn_count_1h`, `small_before_large_2h` | Strong signal | Kept |
| Fraud rings reuse infrastructure | shared IP/device across cards | Strong cross-card signal | Kept |
| Gift cards are high-risk because they are easy to resell | `gift_card` category, repeated gift-card purchases | Strong when repeated or high-value | Kept |
| Online US merchants are suspicious for Canadian cards | country mismatch | Too many false positives for low-value subscriptions | Reduced weight |
| Low-value subscriptions are fraud | rare category plus online channel | Weak signal | Capped unless strong signal exists |
| Merchant compromise creates bursts | `merchant_unique_cards_1h/2h` | Strong cross-card signal | Kept |
| Rare devices and IPs imply fraud | `is_rare_device_for_card`, `is_rare_ip_for_card` | Useful, but noisy on low-value purchases | Made contextual |

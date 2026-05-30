export type ReviewStatus =
  | "unreviewed"
  | "approved_legitimate"
  | "dismissed_flag"
  | "escalated_fraud";

export type Severity = "Low" | "Medium" | "High" | "Critical";

export type Channel = "online" | "in_person" | "atm";

export type TimelineType = "normal" | "warning" | "critical" | "review";

export type TransactionCsvRow = {
  transaction_id: string;
  timestamp: string;
  card_id: string;
  amount: number;
  merchant_name: string;
  merchant_category: string;
  channel: Channel;
  cardholder_country: string;
  merchant_country: string;
  device_id?: string;
  ip_address?: string;
};

export type FraudCase = TransactionCsvRow & {
  fraud_score: number;
  severity: Severity;
  flagged: boolean;
  review_status: ReviewStatus;
  reasons: string[];
  detected_patterns: string[];
  baseline: {
    median_amount: number;
    amount_ratio: number;
    common_categories: string[];
    usual_countries: string[];
    known_devices_count: number;
    known_ips_count: number;
    common_channel: string;
  };
  related_activity: {
    transaction_id: string;
    timestamp: string;
    card_id: string;
    amount: number;
    merchant_name: string;
    reason: string;
  }[];
  timeline: {
    time: string;
    label: string;
    description: string;
    type: TimelineType;
  }[];
};

export const csvInputFields: (keyof TransactionCsvRow)[] = [
  "transaction_id",
  "timestamp",
  "card_id",
  "amount",
  "merchant_name",
  "merchant_category",
  "channel",
  "cardholder_country",
  "merchant_country",
  "device_id",
  "ip_address",
];

export const mockCases: FraudCase[] = [
  {
    transaction_id: "tx_000987",
    timestamp: "2026-05-30 10:27:14",
    card_id: "card_1048",
    amount: 1511.01,
    merchant_name: "Apple Store Online",
    merchant_category: "electronics",
    channel: "online",
    cardholder_country: "CA",
    merchant_country: "US",
    device_id: "dev_new_7f42",
    ip_address: "172.58.44.19",
    fraud_score: 92,
    severity: "Critical",
    flagged: true,
    review_status: "unreviewed",
    reasons: [
      "Amount is 18.4x this card's median transaction.",
      "Online purchase from a device not previously seen on this card.",
      "Same IP address appears on 6 cards within 14 minutes.",
      "Merchant category differs from the card's grocery and restaurant baseline.",
      "Gift-card adjacent electronics cash-out pattern detected.",
    ],
    detected_patterns: [
      "account_takeover",
      "gift_card_cashout",
      "cross_card_ip_reuse",
      "amount_anomaly",
    ],
    baseline: {
      median_amount: 82.12,
      amount_ratio: 18.4,
      common_categories: ["grocery", "restaurant", "fuel"],
      usual_countries: ["CA"],
      known_devices_count: 2,
      known_ips_count: 3,
      common_channel: "in_person",
    },
    related_activity: [
      {
        transaction_id: "tx_000982",
        timestamp: "2026-05-30 10:18:02",
        card_id: "card_1048",
        amount: 4.99,
        merchant_name: "StreamKit",
        reason: "Same card test charge before cash-out.",
      },
      {
        transaction_id: "tx_000991",
        timestamp: "2026-05-30 10:31:41",
        card_id: "card_2201",
        amount: 1240,
        merchant_name: "Apple Store Online",
        reason: "Same IP used across 6 cards.",
      },
      {
        transaction_id: "tx_000995",
        timestamp: "2026-05-30 10:34:09",
        card_id: "card_7784",
        amount: 990.95,
        merchant_name: "GameStop Digital",
        reason: "Similar gift-card cash-out pattern.",
      },
    ],
    timeline: [
      {
        time: "10:02",
        label: "Normal activity",
        description: "In-person coffee purchase near the cardholder's home region.",
        type: "normal",
      },
      {
        time: "10:17",
        label: "New device",
        description: "First appearance of dev_new_7f42 for card_1048.",
        type: "warning",
      },
      {
        time: "10:18",
        label: "Test charge",
        description: "$4.99 online authorization from a streaming merchant.",
        type: "warning",
      },
      {
        time: "10:27",
        label: "Cash-out",
        description: "$1,511.01 electronics purchase from a foreign merchant country.",
        type: "critical",
      },
      {
        time: "10:31",
        label: "Cross-card signal",
        description: "Same IP appears on 4 other cards after this purchase.",
        type: "critical",
      },
    ],
  },
  {
    transaction_id: "tx_000991",
    timestamp: "2026-05-30 10:31:41",
    card_id: "card_2201",
    amount: 1240,
    merchant_name: "Apple Store Online",
    merchant_category: "electronics",
    channel: "online",
    cardholder_country: "CA",
    merchant_country: "US",
    device_id: "dev_new_7f42",
    ip_address: "172.58.44.19",
    fraud_score: 88,
    severity: "High",
    flagged: true,
    review_status: "unreviewed",
    reasons: [
      "Same IP is connected to 6 cards in the current batch.",
      "Device fingerprint matches a critical case already in the queue.",
      "Amount is 12.7x higher than this card's median.",
      "Purchase happened minutes after two low-value online tests.",
    ],
    detected_patterns: [
      "cross_card_ip_reuse",
      "card_testing",
      "gift_card_cashout",
    ],
    baseline: {
      median_amount: 97.64,
      amount_ratio: 12.7,
      common_categories: ["transit", "restaurant", "pharmacy"],
      usual_countries: ["CA"],
      known_devices_count: 1,
      known_ips_count: 4,
      common_channel: "in_person",
    },
    related_activity: [
      {
        transaction_id: "tx_000987",
        timestamp: "2026-05-30 10:27:14",
        card_id: "card_1048",
        amount: 1511.01,
        merchant_name: "Apple Store Online",
        reason: "Same IP and device fingerprint.",
      },
      {
        transaction_id: "tx_000989",
        timestamp: "2026-05-30 10:29:06",
        card_id: "card_2201",
        amount: 3.49,
        merchant_name: "Cloud Notes",
        reason: "Same card test authorization.",
      },
    ],
    timeline: [
      {
        time: "10:12",
        label: "Normal activity",
        description: "Low-value transit tap consistent with card history.",
        type: "normal",
      },
      {
        time: "10:29",
        label: "Test charge",
        description: "$3.49 online authorization from Cloud Notes.",
        type: "warning",
      },
      {
        time: "10:31",
        label: "Cash-out",
        description: "$1,240.00 online electronics purchase.",
        type: "critical",
      },
      {
        time: "10:34",
        label: "Cross-card signal",
        description: "IP reuse now spans six cards in the upload.",
        type: "critical",
      },
    ],
  },
  {
    transaction_id: "tx_001004",
    timestamp: "2026-05-30 11:08:33",
    card_id: "card_3950",
    amount: 3780.44,
    merchant_name: "Maison Luxe London",
    merchant_category: "luxury_goods",
    channel: "online",
    cardholder_country: "US",
    merchant_country: "GB",
    device_id: "dev_chrome_912",
    ip_address: "45.86.201.77",
    fraud_score: 96,
    severity: "Critical",
    flagged: true,
    review_status: "unreviewed",
    reasons: [
      "Amount is 31.2x this card's median transaction.",
      "Foreign online luxury purchase after a long dormant period.",
      "IP geolocation conflicts with the cardholder country.",
      "Merchant is new for this card and category is outside normal behavior.",
    ],
    detected_patterns: ["foreign_high_value", "amount_anomaly", "account_takeover"],
    baseline: {
      median_amount: 121.17,
      amount_ratio: 31.2,
      common_categories: ["grocery", "utilities", "fuel"],
      usual_countries: ["US"],
      known_devices_count: 3,
      known_ips_count: 5,
      common_channel: "in_person",
    },
    related_activity: [
      {
        transaction_id: "tx_000999",
        timestamp: "2026-05-30 10:59:12",
        card_id: "card_3950",
        amount: 1.25,
        merchant_name: "Metro Parking",
        reason: "Low-value test before high-value purchase.",
      },
      {
        transaction_id: "tx_001006",
        timestamp: "2026-05-30 11:10:01",
        card_id: "card_8821",
        amount: 2899,
        merchant_name: "Maison Luxe London",
        reason: "Same merchant within a 3-minute burst.",
      },
    ],
    timeline: [
      {
        time: "08:11",
        label: "Normal activity",
        description: "Utility payment consistent with monthly behavior.",
        type: "normal",
      },
      {
        time: "10:59",
        label: "Test charge",
        description: "$1.25 parking authorization from an unfamiliar IP.",
        type: "warning",
      },
      {
        time: "11:08",
        label: "Cash-out",
        description: "$3,780.44 foreign luxury purchase.",
        type: "critical",
      },
      {
        time: "11:10",
        label: "Merchant burst",
        description: "Another card hits the same merchant from nearby network range.",
        type: "critical",
      },
    ],
  },
  {
    transaction_id: "tx_001019",
    timestamp: "2026-05-30 11:46:52",
    card_id: "card_6118",
    amount: 284.65,
    merchant_name: "Metro Fuel Station 044",
    merchant_category: "fuel",
    channel: "in_person",
    cardholder_country: "US",
    merchant_country: "US",
    device_id: "term_044_2",
    fraud_score: 63,
    severity: "Medium",
    flagged: true,
    review_status: "unreviewed",
    reasons: [
      "Fuel merchant received 19 transactions in 12 minutes.",
      "Amount is 4.6x higher than this card's fuel baseline.",
      "Card was also used 540 miles away earlier today.",
    ],
    detected_patterns: ["merchant_burst", "amount_anomaly"],
    baseline: {
      median_amount: 61.88,
      amount_ratio: 4.6,
      common_categories: ["fuel", "grocery", "quick_service"],
      usual_countries: ["US"],
      known_devices_count: 4,
      known_ips_count: 2,
      common_channel: "in_person",
    },
    related_activity: [
      {
        transaction_id: "tx_001014",
        timestamp: "2026-05-30 11:41:09",
        card_id: "card_7320",
        amount: 274.12,
        merchant_name: "Metro Fuel Station 044",
        reason: "Same merchant burst.",
      },
      {
        transaction_id: "tx_001017",
        timestamp: "2026-05-30 11:44:33",
        card_id: "card_4981",
        amount: 302.76,
        merchant_name: "Metro Fuel Station 044",
        reason: "Same time window at same terminal.",
      },
    ],
    timeline: [
      {
        time: "08:25",
        label: "Normal activity",
        description: "Grocery purchase in the cardholder's usual region.",
        type: "normal",
      },
      {
        time: "11:41",
        label: "Merchant burst",
        description: "First elevated fuel transaction at station 044.",
        type: "warning",
      },
      {
        time: "11:46",
        label: "Current charge",
        description: "$284.65 in-person fuel authorization.",
        type: "warning",
      },
      {
        time: "11:52",
        label: "Cross-card signal",
        description: "Burst reaches 19 cards within 12 minutes.",
        type: "critical",
      },
    ],
  },
  {
    transaction_id: "tx_001027",
    timestamp: "2026-05-30 12:18:44",
    card_id: "card_7403",
    amount: 980,
    merchant_name: "GameStop Digital",
    merchant_category: "digital_goods",
    channel: "online",
    cardholder_country: "CA",
    merchant_country: "US",
    device_id: "dev_android_55e",
    ip_address: "198.51.100.24",
    fraud_score: 84,
    severity: "High",
    flagged: true,
    review_status: "unreviewed",
    reasons: [
      "Multiple digital goods purchases in a 9-minute window.",
      "Card normally transacts in-person and locally.",
      "Amount is 9.8x the card median.",
      "Device was first observed on this transaction.",
    ],
    detected_patterns: ["gift_card_cashout", "merchant_burst", "amount_anomaly"],
    baseline: {
      median_amount: 99.91,
      amount_ratio: 9.8,
      common_categories: ["restaurant", "pharmacy", "grocery"],
      usual_countries: ["CA"],
      known_devices_count: 2,
      known_ips_count: 3,
      common_channel: "in_person",
    },
    related_activity: [
      {
        transaction_id: "tx_001023",
        timestamp: "2026-05-30 12:11:02",
        card_id: "card_7403",
        amount: 59.99,
        merchant_name: "GameStop Digital",
        reason: "Same card ramp-up before larger charge.",
      },
      {
        transaction_id: "tx_001026",
        timestamp: "2026-05-30 12:17:39",
        card_id: "card_1874",
        amount: 1020,
        merchant_name: "GameStop Digital",
        reason: "Same merchant and similar amount.",
      },
    ],
    timeline: [
      {
        time: "12:09",
        label: "New device",
        description: "dev_android_55e appears for the first time.",
        type: "warning",
      },
      {
        time: "12:11",
        label: "Test charge",
        description: "$59.99 digital goods purchase clears.",
        type: "warning",
      },
      {
        time: "12:18",
        label: "Cash-out",
        description: "$980.00 digital goods purchase.",
        type: "critical",
      },
      {
        time: "12:20",
        label: "Merchant burst",
        description: "Similar transactions appear on 3 more cards.",
        type: "critical",
      },
    ],
  },
  {
    transaction_id: "tx_001033",
    timestamp: "2026-05-30 12:41:05",
    card_id: "card_5540",
    amount: 117.42,
    merchant_name: "Harbor Pharmacy",
    merchant_category: "pharmacy",
    channel: "in_person",
    cardholder_country: "US",
    merchant_country: "US",
    device_id: "term_891_known",
    fraud_score: 38,
    severity: "Low",
    flagged: true,
    review_status: "unreviewed",
    reasons: [
      "Amount is 2.6x higher than the card's pharmacy median.",
      "Transaction occurred outside the card's usual weekday time window.",
      "No cross-card device or IP reuse was detected.",
    ],
    detected_patterns: ["amount_anomaly"],
    baseline: {
      median_amount: 45.1,
      amount_ratio: 2.6,
      common_categories: ["pharmacy", "grocery", "healthcare"],
      usual_countries: ["US"],
      known_devices_count: 5,
      known_ips_count: 2,
      common_channel: "in_person",
    },
    related_activity: [
      {
        transaction_id: "tx_000843",
        timestamp: "2026-05-23 13:08:33",
        card_id: "card_5540",
        amount: 42.18,
        merchant_name: "Harbor Pharmacy",
        reason: "Same merchant in normal range.",
      },
    ],
    timeline: [
      {
        time: "09:32",
        label: "Normal activity",
        description: "Grocery purchase from a known terminal.",
        type: "normal",
      },
      {
        time: "12:41",
        label: "Current charge",
        description: "$117.42 at a known pharmacy terminal.",
        type: "warning",
      },
    ],
  },
  {
    transaction_id: "tx_001051",
    timestamp: "2026-05-30 13:22:16",
    card_id: "card_8126",
    amount: 2450.75,
    merchant_name: "AeroWay Tickets",
    merchant_category: "travel",
    channel: "online",
    cardholder_country: "US",
    merchant_country: "NL",
    device_id: "dev_safari_004",
    ip_address: "203.0.113.88",
    fraud_score: 91,
    severity: "Critical",
    flagged: true,
    review_status: "unreviewed",
    reasons: [
      "Travel purchase is 21.9x the card's median amount.",
      "Merchant country is outside usual cardholder countries.",
      "Same IP is linked to a cluster of declined travel attempts.",
      "New device appeared 2 minutes before the purchase.",
    ],
    detected_patterns: [
      "foreign_high_value",
      "cross_card_ip_reuse",
      "account_takeover",
    ],
    baseline: {
      median_amount: 111.91,
      amount_ratio: 21.9,
      common_categories: ["restaurant", "grocery", "services"],
      usual_countries: ["US"],
      known_devices_count: 2,
      known_ips_count: 4,
      common_channel: "in_person",
    },
    related_activity: [
      {
        transaction_id: "tx_001049",
        timestamp: "2026-05-30 13:18:42",
        card_id: "card_8126",
        amount: 2,
        merchant_name: "AeroWay Tickets",
        reason: "Same card low-value airline check.",
      },
      {
        transaction_id: "tx_001052",
        timestamp: "2026-05-30 13:24:01",
        card_id: "card_3097",
        amount: 2288.1,
        merchant_name: "AeroWay Tickets",
        reason: "Same IP and merchant category.",
      },
    ],
    timeline: [
      {
        time: "13:18",
        label: "Test charge",
        description: "$2.00 travel authorization from a new device.",
        type: "warning",
      },
      {
        time: "13:20",
        label: "New device",
        description: "dev_safari_004 registered for the first time.",
        type: "warning",
      },
      {
        time: "13:22",
        label: "Cash-out",
        description: "$2,450.75 foreign travel purchase.",
        type: "critical",
      },
      {
        time: "13:24",
        label: "Cross-card signal",
        description: "Another card attempts similar travel purchase from the same IP.",
        type: "critical",
      },
    ],
  },
  {
    transaction_id: "tx_001063",
    timestamp: "2026-05-30 14:06:58",
    card_id: "card_2672",
    amount: 642.3,
    merchant_name: "North Pier Hotel",
    merchant_category: "lodging",
    channel: "online",
    cardholder_country: "US",
    merchant_country: "US",
    device_id: "dev_win_204",
    ip_address: "192.0.2.118",
    fraud_score: 58,
    severity: "Medium",
    flagged: true,
    review_status: "unreviewed",
    reasons: [
      "Amount is 5.4x higher than this card's median transaction.",
      "Online lodging merchant is new for this card.",
      "IP address is new, but country matches cardholder history.",
      "No cross-card reuse detected in the current batch.",
    ],
    detected_patterns: ["amount_anomaly", "foreign_high_value"],
    baseline: {
      median_amount: 119.03,
      amount_ratio: 5.4,
      common_categories: ["restaurant", "fuel", "grocery"],
      usual_countries: ["US"],
      known_devices_count: 3,
      known_ips_count: 6,
      common_channel: "in_person",
    },
    related_activity: [
      {
        transaction_id: "tx_001061",
        timestamp: "2026-05-30 14:01:21",
        card_id: "card_2672",
        amount: 18.75,
        merchant_name: "North Pier Hotel",
        reason: "Same merchant pre-authorization.",
      },
    ],
    timeline: [
      {
        time: "13:55",
        label: "Normal activity",
        description: "Restaurant purchase in expected country.",
        type: "normal",
      },
      {
        time: "14:01",
        label: "Test charge",
        description: "$18.75 hotel pre-authorization.",
        type: "warning",
      },
      {
        time: "14:06",
        label: "Current charge",
        description: "$642.30 lodging purchase on a new IP.",
        type: "warning",
      },
    ],
  },
];

export const uploadSummary = {
  totalTransactions: 1000,
  totalCards: 50,
  flaggedCases: 67,
  criticalCases: 18,
  highRiskCases: 27,
  patternsFound: 6,
};

export const processingSteps = [
  "Processing transactions...",
  "Building card baselines...",
  "Detecting cross-card patterns...",
  "Preparing review queue...",
];

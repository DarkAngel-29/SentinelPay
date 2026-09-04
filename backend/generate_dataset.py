"""
AI FraudShield — Synthetic Dataset Generator
=============================================
Generates ~15,000 realistic transaction records with 5 behavioural
features and a binary fraud_label target.

Distribution: ~90 % legitimate (13,500), ~10 % fraudulent (1,500).

Features:
- transaction_amount: Amount of current transaction (INR)
- user_avg_amount: User's historical average transaction amount (INR)
- new_recipient: 1 if paying a new beneficiary, 0 if established
- transaction_frequency: Number of transactions in the last 24h window
- transaction_hour: Hour of transaction (0-23)

Realistic Behavioral Overlap:
- Legitimate transactions can have occasional high-value purchases, new payees,
  night hours, or burst velocity.
- Fraudulent transactions can be low-value probing, normal-hour transfers,
  or use compromised existing recipients.
- Labeling is determined through a continuous latent risk model with unobserved
  variance, preventing artificially separable deterministic boundaries.
"""

import os
import numpy as np
import pandas as pd

SEED = 42
N_TOTAL = 15_000
FRAUD_RATIO = 0.10

rng = np.random.default_rng(SEED)


def generate_dataset() -> pd.DataFrame:
    # ── 1. Generate realistic user baselines and transaction attributes ────
    user_avg = rng.uniform(1500, 18000, size=N_TOTAL)

    # Multiplier distribution: mixture of routine, micro, elevated, and high amounts
    mult_type = rng.choice(
        ['routine', 'micro', 'elevated', 'high'],
        size=N_TOTAL,
        p=[0.65, 0.15, 0.12, 0.08]
    )
    mult = np.zeros(N_TOTAL)
    mult[mult_type == 'routine'] = rng.normal(1.0, 0.35, size=np.sum(mult_type == 'routine')).clip(0.2, 2.5)
    mult[mult_type == 'micro'] = rng.uniform(0.05, 0.40, size=np.sum(mult_type == 'micro'))
    mult[mult_type == 'elevated'] = rng.uniform(1.8, 5.0, size=np.sum(mult_type == 'elevated'))
    mult[mult_type == 'high'] = rng.uniform(5.0, 15.0, size=np.sum(mult_type == 'high'))

    amount = np.maximum(50.0, user_avg * mult)

    # Recipient: ~30% base rate of paying new recipients
    new_recip = rng.binomial(1, 0.30, size=N_TOTAL)

    # Transaction frequency in 24h window
    freq_type = rng.choice(['normal', 'active', 'burst'], size=N_TOTAL, p=[0.70, 0.20, 0.10])
    freq = np.zeros(N_TOTAL, dtype=int)
    freq[freq_type == 'normal'] = rng.poisson(1.8, size=np.sum(freq_type == 'normal')) + 1
    freq[freq_type == 'active'] = rng.poisson(4.5, size=np.sum(freq_type == 'active')) + 1
    freq[freq_type == 'burst'] = rng.integers(7, 16, size=np.sum(freq_type == 'burst'))

    # Transaction hour: 80% daytime (7-22), 20% night / irregular (23-6)
    is_night = rng.binomial(1, 0.20, size=N_TOTAL)
    hour = np.zeros(N_TOTAL, dtype=int)
    hour[is_night == 0] = rng.choice(np.arange(7, 23), size=np.sum(is_night == 0))
    hour[is_night == 1] = rng.choice([23, 0, 1, 2, 3, 4, 5, 6], size=np.sum(is_night == 1))

    # ── 2. Latent Behavioral Risk Model ────────────────────────────────────
    # Compute behavioral signals
    amount_ratio = amount / user_avg
    log_amount_ratio = np.log1p(np.maximum(0.0, amount_ratio - 0.5))
    night_flag = np.isin(hour, [23, 0, 1, 2, 3, 4, 5]).astype(float)
    freq_score = np.log1p(freq)

    # Unobserved factors / noise (e.g. device fingerprint, network IP, user hesitation)
    unobserved_noise = rng.normal(0, 1.25, size=N_TOTAL)

    # Latent log-odds of fraud
    z = (
        -4.6
        + 1.10 * log_amount_ratio
        + 1.15 * new_recip
        + 0.85 * freq_score
        + 0.95 * night_flag
        + unobserved_noise
    )

    fraud_probability = 1.0 / (1.0 + np.exp(-z))

    # Top FRAUD_RATIO (10%) are designated as fraudulent
    cutoff = np.quantile(fraud_probability, 1.0 - FRAUD_RATIO)
    fraud_label = (fraud_probability >= cutoff).astype(int)

    df = pd.DataFrame({
        'transaction_amount':   np.round(amount, 2),
        'user_avg_amount':      np.round(user_avg, 2),
        'new_recipient':        new_recip,
        'transaction_frequency': freq,
        'transaction_hour':     hour,
        'fraud_label':          fraud_label,
    })

    df = df.sample(frac=1, random_state=SEED).reset_index(drop=True)
    return df


if __name__ == '__main__':
    out_path = os.path.join(os.path.dirname(__file__), 'dataset.csv')
    df = generate_dataset()
    df.to_csv(out_path, index=False)

    total   = len(df)
    n_fraud = int(df['fraud_label'].sum())
    print(f'Dataset generated: {total} rows')
    print(f'  Legitimate : {total - n_fraud}  ({(total - n_fraud)/total*100:.1f}%)')
    print(f'  Fraudulent : {n_fraud}  ({n_fraud/total*100:.1f}%)')
    print(f'Saved to {out_path}')

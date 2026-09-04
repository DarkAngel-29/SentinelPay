"""
AI FraudShield — Model Training
================================
Loads the synthetic dataset, trains a Random Forest classifier on
5 behavioural features, evaluates on a held-out test set, prints
metrics + feature importances, and saves the model to disk.
"""

import os
import numpy as np
import pandas as pd
from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, roc_auc_score, classification_report,
)
import joblib

FEATURES = [
    'transaction_amount',
    'user_avg_amount',
    'new_recipient',
    'transaction_frequency',
    'transaction_hour',
]
TARGET = 'fraud_label'

SEED = 42
TEST_SIZE = 0.20
N_ESTIMATORS = 100

BASE_DIR = os.path.dirname(__file__)
DATASET_PATH = os.path.join(BASE_DIR, 'dataset.csv')
MODEL_PATH   = os.path.join(BASE_DIR, 'fraud_model.joblib')


def train():
    # ── Load data ────────────────────────────────────────────────
    df = pd.read_csv(DATASET_PATH)
    print(f'Loaded {len(df)} rows from {DATASET_PATH}\n')

    X = df[FEATURES]
    y = df[TARGET]

    # ── Split ────────────────────────────────────────────────────
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=TEST_SIZE, random_state=SEED, stratify=y
    )
    print(f'Train: {len(X_train)}  |  Test: {len(X_test)}')
    print(f'Train fraud ratio: {y_train.mean():.3f}')
    print(f'Test  fraud ratio: {y_test.mean():.3f}\n')

    # ── Train ────────────────────────────────────────────────────
    model = RandomForestClassifier(
        n_estimators=N_ESTIMATORS,
        random_state=SEED,
        class_weight='balanced',   # handle imbalance
        n_jobs=-1,
    )
    model.fit(X_train, y_train)

    # ── Evaluate ─────────────────────────────────────────────────
    y_pred  = model.predict(X_test)
    y_proba = model.predict_proba(X_test)[:, 1]

    acc  = accuracy_score(y_test, y_pred)
    prec = precision_score(y_test, y_pred)
    rec  = recall_score(y_test, y_pred)
    f1   = f1_score(y_test, y_pred)
    auc  = roc_auc_score(y_test, y_proba)

    print('MODEL PERFORMANCE')
    print('-' * 40)
    print(f'  Accuracy  : {acc:.4f}  ({acc*100:.1f}%)')
    print(f'  Precision : {prec:.4f}  ({prec*100:.1f}%)')
    print(f'  Recall    : {rec:.4f}  ({rec*100:.1f}%)')
    print(f'  F1 Score  : {f1:.4f}  ({f1*100:.1f}%)')
    print(f'  ROC-AUC   : {auc:.4f}  ({auc*100:.1f}%)')
    print()

    # ── Feature importances ──────────────────────────────────────
    importances = model.feature_importances_
    sorted_idx = np.argsort(importances)[::-1]
    print('FEATURE IMPORTANCES')
    print('-' * 40)
    for i in sorted_idx:
        bar = '#' * int(importances[i] * 40)
        print(f'  {FEATURES[i]:<25s} {importances[i]:.4f}  {bar}')
    print()

    # ── Full classification report ───────────────────────────────
    print('CLASSIFICATION REPORT')
    print('-' * 40)
    print(classification_report(y_test, y_pred, target_names=['Legitimate', 'Fraudulent']))

    # ── Save ─────────────────────────────────────────────────────
    joblib.dump(model, MODEL_PATH)
    print(f'Model saved to {MODEL_PATH}')


if __name__ == '__main__':
    train()

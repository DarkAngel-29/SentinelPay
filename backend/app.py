"""
AI FraudShield — FastAPI Backend
=================================
Serves the trained Random Forest model via a /predict endpoint.
CORS enabled for local file:// and localhost origins.
"""

import os
import numpy as np
import joblib
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

BASE_DIR   = os.path.dirname(__file__)
MODEL_PATH = os.path.join(BASE_DIR, 'fraud_model.joblib')

# ── Load model at startup ────────────────────────────────────────
model = None
try:
    model = joblib.load(MODEL_PATH)
    print(f'[FraudShield] Model loaded from {MODEL_PATH}')
except Exception as e:
    print(f'[FraudShield] WARNING — could not load model: {e}')

app = FastAPI(title='AI FraudShield — Risk API')

# Allow the frontend (served from file:// or localhost dev server)
app.add_middleware(
    CORSMiddleware,
    allow_origins=['*'],       # wide-open for hackathon; lock down in prod
    allow_methods=['*'],
    allow_headers=['*'],
)


# ── Request / Response schemas ───────────────────────────────────

class PredictRequest(BaseModel):
    transaction_amount: float
    user_avg_amount: float
    new_recipient: int          # 0 or 1
    transaction_frequency: int
    transaction_hour: int       # 0–23


class PredictResponse(BaseModel):
    model_config = {'protected_namespaces': ()}

    risk_score: int             # 0–100
    risk_level: str             # LOW / MEDIUM / HIGH
    fraud_probability: float    # raw model output
    features: dict              # echo back for UI explanation
    model_status: str           # ONLINE


# ── Endpoints ────────────────────────────────────────────────────

@app.get('/health')
def health():
    return {
        'status': 'ok',
        'model_loaded': model is not None,
    }


@app.post('/predict', response_model=PredictResponse)
def predict(req: PredictRequest):
    if model is None:
        # Model didn't load — return a safe mid-range score
        return PredictResponse(
            risk_score=50,
            risk_level='MEDIUM',
            fraud_probability=0.50,
            features=req.model_dump(),
            model_status='MODEL_ERROR',
        )

    features = np.array([[
        req.transaction_amount,
        req.user_avg_amount,
        req.new_recipient,
        req.transaction_frequency,
        req.transaction_hour,
    ]])

    fraud_prob = float(model.predict_proba(features)[0][1])
    risk_score = int(round(fraud_prob * 100))
    risk_score = max(0, min(100, risk_score))

    if risk_score < 30:
        risk_level = 'LOW'
    elif risk_score < 60:
        risk_level = 'MEDIUM'
    else:
        risk_level = 'HIGH'

    return PredictResponse(
        risk_score=risk_score,
        risk_level=risk_level,
        fraud_probability=round(fraud_prob, 4),
        features=req.model_dump(),
        model_status='ONLINE',
    )

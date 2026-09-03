/* ═══════════════════════════════════════════════════════════════
   AI FRAUDSHIELD — app.js
   Behavioral Risk Engine + Step-Up Verification Flow
   ═══════════════════════════════════════════════════════════════ */

'use strict';

/* ──────────────────────────────────────────────────────────────
   MOCK DATA
   ────────────────────────────────────────────────────────────── */

// Known recipients — used by the risk engine for history lookup
const KNOWN_RECIPIENTS = [
  'Rahul Sharma', 'MSEDCL', 'Big Bazaar', 'Property Manager', 'Flipkart',
  'Amazon', 'Swiggy', 'Zomato', 'HDFC Bank', 'SBI',
];

const MOCK_TRANSACTIONS = [
  { id: 'TX-8821', name: 'Grocery Store',    merchant: 'Big Bazaar, Andheri', amount: 2450,  date: '2026-09-03', time: '09:14', category: 'Groceries', status: 'normal'  },
  { id: 'TX-8820', name: 'Electricity Bill', merchant: 'MSEDCL',              amount: 1820,  date: '2026-09-02', time: '18:31', category: 'Utilities', status: 'normal'  },
  { id: 'TX-8819', name: 'Rahul Sharma',     merchant: 'Bank Transfer',        amount: 5000,  date: '2026-09-02', time: '14:07', category: 'Transfer',  status: 'normal'  },
  { id: 'TX-8818', name: 'Rent — August',    merchant: 'Property Manager',     amount: 12000, date: '2026-09-01', time: '10:00', category: 'Housing',   status: 'normal'  },
  { id: 'TX-8817', name: 'Online Shopping',  merchant: 'Flipkart',             amount: 3200,  date: '2026-08-31', time: '22:45', category: 'Shopping',  status: 'normal'  },
];

const MOCK_PROFILE = {
  avgTransfer:           4200,
  typicalRangeMin:       500,
  typicalRangeMax:       15000,
  transactionsAnalyzed:  127,
  profileStatus:         'ESTABLISHED',
  riskMonitoring:        'ACTIVE',
  // Recent transaction timestamps (epoch ms) — for velocity check
  recentTxTimestamps:    [
    Date.now() - 1000 * 60 * 60 * 2,   // 2h ago
    Date.now() - 1000 * 60 * 60 * 8,   // 8h ago
  ],
  // Typical active hours (24h)
  typicalHoursStart: 8,
  typicalHoursEnd:   21,
};

/* Active transaction context — set when user submits the form */
let ACTIVE_TX = null;

/* Countdown timer handle */
let _countdownInterval = null;


/* ──────────────────────────────────────────────────────────────
   HELPERS
   ────────────────────────────────────────────────────────────── */

function formatAmount(n) {
  return '₹' + Number(n).toLocaleString('en-IN');
}

function formatDatetime(date, time) {
  const d = new Date(`${date}T${time}`);
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  return `${d.toLocaleDateString('en-IN', opts)} · ${time}`;
}

function parseAmount(str) {
  return parseFloat(String(str).replace(/[^0-9.]/g, '')) || 0;
}

function now() {
  const d = new Date();
  return `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

function currentHour() {
  return new Date().getHours();
}

function isKnownRecipient(name) {
  if (!name) return false;
  const n = name.trim().toLowerCase();
  return KNOWN_RECIPIENTS.some(r => r.toLowerCase().includes(n) || n.includes(r.toLowerCase()));
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}


/* ──────────────────────────────────────────────────────────────
   BEHAVIORAL RISK ENGINE
   ──────────────────────────────────────────────────────────────
   calculateRisk(transaction, profile) → { score, level, factors }

   This is the single source of truth for risk decisions.
   Replace the body of this function with a real ML/backend call
   when the model is ready — the UI wiring does not need to change.
   ────────────────────────────────────────────────────────────── */

function calculateRisk(transaction, profile) {
  const { amount, recipient } = transaction;
  const factors = [];
  let score = 0;

  /* 1 — AMOUNT ANOMALY */
  const ratio = amount / profile.avgTransfer;
  if (amount > profile.typicalRangeMax && ratio >= 10) {
    const pts = 40;
    score += pts;
    factors.push({
      signal:  'AMOUNT',
      points:  pts,
      label:   'Amount severely above normal',
      detail:  `${formatAmount(amount)} is ${ratio.toFixed(1)}× your average. Typical range: ${formatAmount(profile.typicalRangeMin)} – ${formatAmount(profile.typicalRangeMax)}.`,
      verdict: 'SEVERE DEVIATION',
    });
  } else if (amount > profile.typicalRangeMax && ratio >= 3) {
    const pts = 30;
    score += pts;
    factors.push({
      signal:  'AMOUNT',
      points:  pts,
      label:   'Amount significantly above normal',
      detail:  `${formatAmount(amount)} is ${ratio.toFixed(1)}× your average. Typical range: ${formatAmount(profile.typicalRangeMin)} – ${formatAmount(profile.typicalRangeMax)}.`,
      verdict: 'SIGNIFICANT DEVIATION',
    });
  } else if (amount > profile.typicalRangeMax) {
    const pts = 20;
    score += pts;
    factors.push({
      signal:  'AMOUNT',
      points:  pts,
      label:   'Amount above typical range',
      detail:  `${formatAmount(amount)} exceeds your typical range of ${formatAmount(profile.typicalRangeMin)} – ${formatAmount(profile.typicalRangeMax)}.`,
      verdict: 'ABOVE RANGE',
    });
  }

  /* 2 — NEW RECIPIENT */
  const known = isKnownRecipient(recipient);
  if (!known) {
    const pts = 20;
    score += pts;
    factors.push({
      signal:  'RECIPIENT',
      points:  pts,
      label:   'New recipient',
      detail:  `"${recipient}" has no previous transfer history on this account.`,
      verdict: 'NEW RECIPIENT',
    });
  }

  /* 3 — RECIPIENT HISTORY */
  if (!known) {
    const pts = 10;
    score += pts;
    factors.push({
      signal:  'HISTORY',
      points:  pts,
      label:   'No prior transfer history',
      detail:  `No previous transactions found for "${recipient}".`,
      verdict: 'NO HISTORY',
    });
  }

  /* 4 — VELOCITY */
  const recentCount = profile.recentTxTimestamps.filter(
    ts => (Date.now() - ts) < 1000 * 60 * 60 * 1  // within last 1 hour
  ).length;
  if (recentCount >= 3) {
    const pts = 20;
    score += pts;
    factors.push({
      signal:  'VELOCITY',
      points:  pts,
      label:   'High transaction velocity',
      detail:  `${recentCount} transactions in the last hour, which is unusual.`,
      verdict: 'HIGH VELOCITY',
    });
  } else if (recentCount >= 2) {
    const pts = 10;
    score += pts;
    factors.push({
      signal:  'VELOCITY',
      points:  pts,
      label:   'Elevated transaction frequency',
      detail:  `${recentCount} transactions in the last hour.`,
      verdict: 'ELEVATED',
    });
  }

  /* 5 — TIME OF DAY */
  const h = currentHour();
  const isUnusualTime = h < profile.typicalHoursStart || h >= profile.typicalHoursEnd;
  if (isUnusualTime) {
    const pts = 10;
    score += pts;
    factors.push({
      signal:  'TIME',
      points:  pts,
      label:   'Outside usual transaction hours',
      detail:  `Transaction at ${now()} — your typical activity is ${profile.typicalHoursStart}:00 – ${profile.typicalHoursEnd}:00.`,
      verdict: 'UNUSUAL TIME',
    });
  }

  /* 6 — DEVICE / SESSION (mock: flag if new recipient + large amount = suspicious session) */
  if (!known && amount > profile.typicalRangeMax) {
    const pts = 10;
    score += pts;
    factors.push({
      signal:  'SESSION',
      points:  pts,
      label:   'Atypical session pattern',
      detail:  'Large transfer to unknown recipient from current session.',
      verdict: 'ANOMALOUS',
    });
  }

  score = clamp(score, 0, 100);

  let level;
  if (score < 30)      level = 'LOW';
  else if (score < 60) level = 'MEDIUM';
  else                 level = 'HIGH';

  return { score, level, factors };
}


/* ──────────────────────────────────────────────────────────────
   RENDER TRANSACTION TABLE
   ────────────────────────────────────────────────────────────── */

function renderTransactions(transactions) {
  const tbody = document.getElementById('tx-body');
  if (!tbody) return;
  tbody.innerHTML = transactions.map(tx => {
    const badgeClass = `status-badge--${tx.status}`;
    return `
      <tr class="tx-row" data-tx-id="${tx.id}">
        <td class="tx-td tx-td--name">
          ${tx.name}
          <br />
          <span style="font-size:0.7rem;color:var(--clr-text-dim);font-weight:400;">${tx.merchant}</span>
        </td>
        <td class="tx-td tx-td--amt">${formatAmount(tx.amount)}</td>
        <td class="tx-td tx-td--date">${formatDatetime(tx.date, tx.time)}</td>
        <td class="tx-td tx-td--cat">${tx.category}</td>
        <td class="tx-td tx-td--status">
          <span class="status-badge ${badgeClass}">${tx.status.toUpperCase()}</span>
        </td>
      </tr>`;
  }).join('');
}

function addTransaction(recipient, amount, status) {
  const tx = {
    id:       `TX-${Math.floor(Math.random() * 9000 + 1000)}`,
    name:     recipient,
    merchant: 'Bank Transfer',
    amount:   amount,
    date:     todayISO(),
    time:     now(),
    category: 'Transfer',
    status:   status,
  };
  MOCK_TRANSACTIONS.unshift(tx);
  MOCK_PROFILE.transactionsAnalyzed += 1;
  renderTransactions(MOCK_TRANSACTIONS.slice(0, 5));
  updateStats();
  updateFooterNote();
}

function updateFooterNote() {
  const el = document.querySelector('.tx-footer-note');
  if (el) el.textContent = `${MOCK_PROFILE.transactionsAnalyzed} transactions analyzed this month.`;
}


/* ──────────────────────────────────────────────────────────────
   STATS & SIDEBAR
   ────────────────────────────────────────────────────────────── */

function updateStats() {
  const countEl = document.getElementById('tx-count');
  const scanEl  = document.getElementById('last-scan');
  const timeEl  = document.getElementById('sidebar-time');
  if (countEl) countEl.textContent = MOCK_PROFILE.transactionsAnalyzed;
  if (scanEl)  scanEl.textContent  = now();
  if (timeEl)  timeEl.textContent  = now();
}

// Security status dynamic state
function setSecurityState(state) {
  const riskVal = document.getElementById('stat-risk-value');
  const alertRow = document.getElementById('stat-alert-row');
  const alertVal = document.getElementById('stat-alert-value');
  const mainStatus = document.getElementById('sec-main-status');
  const mainSub    = document.getElementById('sec-main-sub');

  const states = {
    normal: {
      mainStatus: 'ACTIVE', mainStatusColor: 'var(--clr-ok)', mainSub: 'All behavioral monitors running.',
      riskVal: 'ACTIVE', riskColor: 'var(--clr-ok)', alert: null,
    },
    alert: {
      mainStatus: 'ALERT', mainStatusColor: 'var(--clr-accent)', mainSub: 'High-risk transaction detected.',
      riskVal: 'ACTIVE', riskColor: 'var(--clr-ok)', alert: { label: 'CURRENT ALERT', value: 'HIGH RISK', color: 'var(--clr-danger)' },
    },
    verifying: {
      mainStatus: 'VERIFYING', mainStatusColor: 'var(--clr-accent)', mainSub: 'Step-up verification in progress.',
      riskVal: 'ACTIVE', riskColor: 'var(--clr-ok)', alert: { label: 'STEP-UP', value: 'ACTIVE', color: 'var(--clr-accent)' },
    },
    verified: {
      mainStatus: 'VERIFIED', mainStatusColor: 'var(--clr-ok)', mainSub: 'Identity confirmed. Transaction authorized.',
      riskVal: 'ACTIVE', riskColor: 'var(--clr-ok)', alert: { label: 'VERIFICATION', value: 'PASSED', color: 'var(--clr-ok)' },
    },
    blocked: {
      mainStatus: 'BLOCKED', mainStatusColor: 'var(--clr-danger)', mainSub: 'Transaction stopped by user.',
      riskVal: 'ACTIVE', riskColor: 'var(--clr-ok)', alert: { label: 'THREAT', value: 'BLOCKED', color: 'var(--clr-danger)' },
    },
  };

  const s = states[state] || states.normal;
  if (mainStatus) { mainStatus.textContent = s.mainStatus; mainStatus.style.color = s.mainStatusColor; }
  if (mainSub)    mainSub.textContent = s.mainSub;
  if (riskVal)    { riskVal.textContent = s.riskVal; riskVal.style.color = s.riskColor; }

  if (alertRow && alertVal) {
    if (s.alert) {
      alertRow.style.display = '';
      const label = alertRow.querySelector('.stat-label');
      if (label) label.textContent = s.alert.label;
      alertVal.textContent = s.alert.value;
      alertVal.style.color = s.alert.value === 'ACTIVE' || s.alert.value === 'PASSED'
        ? s.alert.color : s.alert.color;
    } else {
      alertRow.style.display = 'none';
    }
  }
}


/* ──────────────────────────────────────────────────────────────
   RISK CHECKER — live field feedback
   ────────────────────────────────────────────────────────────── */

function initRiskChecker() {
  const amountInput = document.getElementById('amount');
  const riskFlag    = document.getElementById('risk-flag');
  if (!amountInput || !riskFlag) return;

  amountInput.addEventListener('input', () => {
    const val = parseAmount(amountInput.value);
    if (!val) { riskFlag.textContent = ''; riskFlag.className = 'risk-flag'; return; }
    if (val > MOCK_PROFILE.typicalRangeMax) {
      riskFlag.textContent = '⚑ ABOVE TYPICAL RANGE';
      riskFlag.className   = 'risk-flag flag--high';
    } else {
      riskFlag.textContent = '✓ WITHIN RANGE';
      riskFlag.className   = 'risk-flag flag--ok';
    }
  });
}


/* ──────────────────────────────────────────────────────────────
   MODAL — shell management
   ────────────────────────────────────────────────────────────── */

function openOverlay() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) { overlay.removeAttribute('hidden'); document.body.style.overflow = 'hidden'; }
}

function closeOverlay() {
  clearCountdown();
  const overlay = document.getElementById('modal-overlay');
  if (overlay) { overlay.setAttribute('hidden', ''); document.body.style.overflow = ''; }
  ACTIVE_TX = null;
}

function setModalContent(html) {
  const modal = document.getElementById('modal');
  if (modal) modal.innerHTML = html;
  // Re-bind close button if present
  const cb = document.getElementById('modal-close');
  if (cb) cb.addEventListener('click', () => { closeOverlay(); setSecurityState('normal'); });
}

function clearCountdown() {
  if (_countdownInterval) { clearInterval(_countdownInterval); _countdownInterval = null; }
}


/* ──────────────────────────────────────────────────────────────
   MODAL STATES
   ────────────────────────────────────────────────────────────── */

/* ── LOW RISK: simple confirmation ── */
function showLowRisk(tx, riskResult) {
  setModalContent(`
    <div class="modal-header">
      <p class="modal-eyebrow mono">TRANSACTION CHECK</p>
      <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
    </div>
    <h3 class="modal-title" style="color:var(--clr-ok);">LOW RISK</h3>
    <p class="modal-body">This transaction matches your usual behavior. No unusual signals detected.</p>
    <div class="modal-details">
      <div class="modal-detail-row"><span>RECIPIENT</span><span>${tx.recipient}</span></div>
      <div class="modal-detail-row"><span>AMOUNT</span><span>${formatAmount(tx.amount)}</span></div>
      <div class="modal-detail-row"><span>RISK SCORE</span><span style="color:var(--clr-ok);">${riskResult.score} / 100 — LOW</span></div>
    </div>
    <div class="modal-actions">
      <button class="btn-primary" id="btn-proceed" style="background:var(--clr-ok);border-color:var(--clr-ok);">PROCEED →</button>
      <button class="btn-ghost" id="btn-cancel">CANCEL</button>
    </div>
  `);
  document.getElementById('btn-proceed').addEventListener('click', () => {
    closeOverlay();
    finalizeTransaction(tx, 'normal');
    showToast('Transaction processed successfully.', 'ok');
    setSecurityState('normal');
  });
  document.getElementById('btn-cancel').addEventListener('click', () => {
    closeOverlay();
    setSecurityState('normal');
  });
}

/* ── MEDIUM RISK: explain + verify ── */
function showMediumRisk(tx, riskResult) {
  const factorsHtml = riskResult.factors.map(f => `
    <div class="risk-factor-row">
      <span class="risk-factor-pts">+${f.points}</span>
      <span class="risk-factor-label">${f.label}</span>
    </div>`).join('');

  setModalContent(`
    <div class="modal-header">
      <p class="modal-eyebrow mono">FRAUDSHIELD ALERT</p>
      <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
    </div>
    <h3 class="modal-title" style="color:var(--clr-accent);">CONFIRMATION REQUIRED</h3>
    <p class="modal-body">This transaction triggered a moderate risk signal. Please review before proceeding.</p>

    <div class="modal-score-row">
      <div class="modal-score-block">
        <p class="modal-score-num" style="color:var(--clr-accent);">${riskResult.score}</p>
        <p class="modal-score-sub mono">RISK SCORE / 100</p>
      </div>
      <div class="modal-score-level" style="color:var(--clr-accent);">MEDIUM</div>
    </div>

    <div class="modal-details">
      <div class="modal-detail-row"><span>RECIPIENT</span><span>${tx.recipient}</span></div>
      <div class="modal-detail-row"><span>AMOUNT</span><span>${formatAmount(tx.amount)}</span></div>
    </div>

    <div class="modal-factors-block">
      <p class="modal-factors-label mono">WHY THIS WAS FLAGGED</p>
      ${factorsHtml}
    </div>

    <div class="modal-actions">
      <button class="btn-primary" id="btn-verify">VERIFY &amp; CONTINUE →</button>
      <button class="btn-ghost" id="btn-cancel">CANCEL</button>
    </div>
  `);
  document.getElementById('btn-verify').addEventListener('click', () => showVerification(tx, riskResult));
  document.getElementById('btn-cancel').addEventListener('click', () => { closeOverlay(); setSecurityState('normal'); });
}

/* ── HIGH RISK: full alert + step-up ── */
function showHighRisk(tx, riskResult) {
  const factorsHtml = riskResult.factors.map(f => `
    <div class="risk-factor-row">
      <span class="risk-factor-pts">+${f.points}</span>
      <span class="risk-factor-label">${f.label}</span>
    </div>`).join('');

  const signalCardsHtml = riskResult.factors.map(f => `
    <div class="signal-card">
      <p class="signal-card-label mono">${f.signal}</p>
      <p class="signal-card-verdict" style="color:var(--clr-danger);">${f.verdict}</p>
      <p class="signal-card-detail">${f.detail}</p>
    </div>`).join('');

  setModalContent(`
    <div class="modal-header">
      <p class="modal-eyebrow mono">FRAUDSHIELD ALERT</p>
      <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
    </div>
    <h3 class="modal-title">UNUSUAL TRANSACTION DETECTED</h3>

    <div class="modal-score-row">
      <div class="modal-score-block">
        <p class="modal-score-num" style="color:var(--clr-danger);">${riskResult.score}</p>
        <p class="modal-score-sub mono">RISK SCORE / 100</p>
      </div>
      <div class="modal-score-level" style="color:var(--clr-danger);">HIGH RISK</div>
    </div>

    <div class="modal-details">
      <div class="modal-detail-row"><span>RECIPIENT</span><span>${tx.recipient}</span></div>
      <div class="modal-detail-row"><span>AMOUNT</span><span>${formatAmount(tx.amount)}</span></div>
      <div class="modal-detail-row"><span>YOUR AVG.</span><span>${formatAmount(MOCK_PROFILE.avgTransfer)}</span></div>
    </div>

    <div class="modal-factors-block">
      <p class="modal-factors-label mono">WHY THIS WAS FLAGGED</p>
      ${factorsHtml}
    </div>

    <div class="modal-signal-grid">
      ${signalCardsHtml}
    </div>

    <div class="modal-actions">
      <button class="btn-primary" id="btn-verify">VERIFY IDENTITY →</button>
      <button class="btn-ghost" id="btn-cancel">CANCEL TRANSACTION</button>
    </div>
    <p class="modal-note mono">FraudShield does not block legitimate users. We verify first.</p>
  `);
  document.getElementById('btn-verify').addEventListener('click', () => { showVerification(tx, riskResult); setSecurityState('verifying'); });
  document.getElementById('btn-cancel').addEventListener('click', () => {
    closeOverlay();
    showToast('Transaction cancelled.', 'warn');
    setSecurityState('normal');
  });
}

/* ── STEP-UP VERIFICATION ── */
function showVerification(tx, riskResult) {
  setSecurityState('verifying');
  setModalContent(`
    <div class="modal-header">
      <p class="modal-eyebrow mono">FRAUDSHIELD VERIFICATION</p>
      <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
    </div>
    <h3 class="modal-title">IDENTITY CHECK REQUIRED</h3>
    <p class="modal-body">For your security, verify that you authorized this transaction.</p>

    <div class="modal-details" style="margin-bottom:20px;">
      <div class="modal-detail-row"><span>TRANSACTION</span><span>${formatAmount(tx.amount)}</span></div>
      <div class="modal-detail-row"><span>RECIPIENT</span><span>${tx.recipient}</span></div>
      <div class="modal-detail-row"><span>RISK LEVEL</span><span style="color:var(--clr-danger);">${riskResult.level}</span></div>
    </div>

    <div class="face-verify-area" id="face-verify-area">
      <div class="face-verify-frame">
        <div class="face-verify-reticle">
          <span class="reticle-corner tl"></span>
          <span class="reticle-corner tr"></span>
          <span class="reticle-corner bl"></span>
          <span class="reticle-corner br"></span>
          <p class="face-verify-inner-label mono">CAMERA ACCESS<br/>NOT YET IMPLEMENTED</p>
        </div>
      </div>
      <p class="face-verify-hint mono">Face recognition will be integrated in the next stage.</p>
    </div>

    <div class="verify-status-row">
      <div class="verify-status-left">
        <p class="verify-status-label mono">VERIFICATION STATUS</p>
        <p class="verify-status-value mono" id="verify-status-text">WAITING FOR USER</p>
      </div>
      <div class="verify-countdown-block">
        <p class="verify-countdown-num" id="countdown-num">20</p>
        <p class="verify-countdown-label mono">SECONDS REMAINING</p>
      </div>
    </div>

    <div class="modal-actions" style="margin-top:16px;">
      <button class="btn-ghost" id="btn-cancel-verify">CANCEL VERIFICATION</button>
    </div>
  `);

  document.getElementById('btn-cancel-verify').addEventListener('click', () => {
    closeOverlay();
    setSecurityState('normal');
  });

  // Start countdown
  let secondsLeft = 20;
  const numEl = document.getElementById('countdown-num');
  const statusEl = document.getElementById('verify-status-text');

  clearCountdown();
  _countdownInterval = setInterval(() => {
    secondsLeft -= 1;
    if (numEl) numEl.textContent = secondsLeft;

    if (secondsLeft <= 5 && statusEl) {
      statusEl.textContent = 'TIMING OUT...';
      statusEl.style.color = 'var(--clr-accent)';
      if (numEl) numEl.style.color = 'var(--clr-danger)';
    }

    if (secondsLeft <= 0) {
      clearCountdown();
      showCallFallback(tx, riskResult);
    }
  }, 1000);
}

/* ── AI VOICE CALL FALLBACK ── */
function showCallFallback(tx, riskResult) {
  setModalContent(`
    <div class="modal-header">
      <p class="modal-eyebrow mono">VERIFICATION TIMEOUT</p>
      <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
    </div>
    <h3 class="modal-title" style="color:var(--clr-accent);">FACE VERIFICATION TIMED OUT</h3>
    <p class="modal-body">To protect your account, FraudShield is initiating a voice verification call.</p>

    <div class="call-interface" id="call-interface">
      <div class="call-status-block">
        <p class="call-number mono">+91 ••••• •••••</p>
        <div class="call-pulse-wrap">
          <span class="call-pulse-ring"></span>
          <span class="call-pulse-ring ring-2"></span>
          <span class="call-icon-inner mono">☎</span>
        </div>
        <p class="call-status-text mono" id="call-status-text">CALLING...</p>
      </div>
      <div class="call-label-block">
        <p class="call-system-label mono">FRAUDSHIELD SECURITY CALL</p>
        <p class="call-sub">Simulated · No real call placed</p>
      </div>
    </div>
  `);

  // Simulate call connecting after 2.5s
  setTimeout(() => {
    showCallConnected(tx, riskResult);
  }, 2500);
}

/* ── CALL CONNECTED — transcript + decision ── */
function showCallConnected(tx, riskResult) {
  setModalContent(`
    <div class="modal-header">
      <p class="modal-eyebrow mono">FRAUDSHIELD SECURITY CALL</p>
      <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
    </div>
    <h3 class="modal-title" style="color:var(--clr-ok);font-size:1.4rem;">CALL CONNECTED</h3>

    <div class="call-transcript" id="call-transcript">
      <div class="transcript-line" id="tl-1" style="opacity:0;">
        <span class="transcript-speaker mono">FRAUDSHIELD</span>
        <span class="transcript-text">"A transaction of ${formatAmount(tx.amount)} to ${tx.recipient} is being attempted from your account."</span>
      </div>
      <div class="transcript-line" id="tl-2" style="opacity:0;">
        <span class="transcript-speaker mono">FRAUDSHIELD</span>
        <span class="transcript-text">"Did you authorize this transaction?"</span>
      </div>
    </div>

    <div class="modal-actions" id="call-actions" style="opacity:0;margin-top:24px;">
      <button class="btn-primary" id="btn-yes" style="background:var(--clr-ok);border-color:var(--clr-ok);">YES, IT WAS ME</button>
      <button class="btn-primary btn-danger" id="btn-no">NO, BLOCK IT</button>
    </div>
  `);

  // Animate transcript lines
  setTimeout(() => { const el = document.getElementById('tl-1'); if(el) el.style.opacity = '1'; el.style.transition = 'opacity 0.4s'; }, 400);
  setTimeout(() => { const el = document.getElementById('tl-2'); if(el) el.style.opacity = '1'; el.style.transition = 'opacity 0.4s'; }, 1600);
  setTimeout(() => { const el = document.getElementById('call-actions'); if(el) { el.style.opacity = '1'; el.style.transition = 'opacity 0.4s'; } }, 2600);

  // Bind decision buttons (added after delay so DOM is ready)
  setTimeout(() => {
    const btnYes = document.getElementById('btn-yes');
    const btnNo  = document.getElementById('btn-no');
    if (btnYes) btnYes.addEventListener('click', () => handleCallDecision(tx, true));
    if (btnNo)  btnNo.addEventListener('click',  () => handleCallDecision(tx, false));
  }, 100);
}

/* ── FINAL DECISION ── */
function handleCallDecision(tx, authorized) {
  clearCountdown();
  if (authorized) {
    setModalContent(`
      <div class="modal-header">
        <p class="modal-eyebrow mono">TRANSACTION VERIFIED</p>
        <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
      </div>
      <h3 class="modal-title" style="color:var(--clr-ok);">TRANSACTION AUTHORIZED</h3>
      <div class="modal-score-row" style="justify-content:center;padding:28px 0;">
        <div style="text-align:center;">
          <p style="font-family:var(--font-display);font-weight:900;font-size:3rem;color:var(--clr-ok);line-height:1;">${formatAmount(tx.amount)}</p>
          <p class="mono" style="font-size:0.65rem;color:var(--clr-text-muted);letter-spacing:0.14em;margin-top:8px;">TRANSACTION TO ${tx.recipient.toUpperCase()}</p>
          <p class="mono" style="font-size:0.62rem;color:var(--clr-ok);letter-spacing:0.1em;margin-top:12px;">IDENTITY CONFIRMED BY VOICE VERIFICATION</p>
        </div>
      </div>
      <div class="modal-actions">
        <button class="btn-primary" id="btn-done" style="background:var(--clr-ok);border-color:var(--clr-ok);">DONE</button>
      </div>
    `);
    addTransaction(tx.recipient, tx.amount, 'verified');
    showToast('Transaction verified and processed.', 'ok');
    setSecurityState('verified');
    resetForm();
    document.getElementById('btn-done').addEventListener('click', () => { closeOverlay(); setSecurityState('normal'); });

  } else {
    setModalContent(`
      <div class="modal-header">
        <p class="modal-eyebrow mono">TRANSACTION BLOCKED</p>
        <button class="modal-close" id="modal-close" aria-label="Close">✕</button>
      </div>
      <h3 class="modal-title" style="color:var(--clr-danger);">TRANSACTION STOPPED</h3>
      <p class="modal-body">You indicated you did not authorize this transaction. FraudShield has blocked it.</p>
      <div class="modal-details">
        <div class="modal-detail-row"><span>RECIPIENT</span><span>${tx.recipient}</span></div>
        <div class="modal-detail-row"><span>AMOUNT</span><span>${formatAmount(tx.amount)}</span></div>
        <div class="modal-detail-row"><span>ACTION</span><span style="color:var(--clr-danger);">BLOCKED BY USER</span></div>
      </div>
      <div class="modal-actions">
        <button class="btn-ghost" id="btn-done">CLOSE</button>
      </div>
      <p class="modal-note mono">If you believe this was unauthorized access, contact your bank immediately.</p>
    `);
    addTransaction(tx.recipient, tx.amount, 'blocked');
    showToast('Transaction blocked. Your account is safe.', 'danger');
    setSecurityState('blocked');
    resetForm();
    document.getElementById('btn-done').addEventListener('click', () => { closeOverlay(); setSecurityState('normal'); });
  }
}


/* ──────────────────────────────────────────────────────────────
   FORM
   ────────────────────────────────────────────────────────────── */

function resetForm() {
  const recipientEl = document.getElementById('recipient');
  const amountEl    = document.getElementById('amount');
  const noteEl      = document.getElementById('note');
  if (recipientEl) recipientEl.value = '';
  if (amountEl)    amountEl.value    = '5,000';
  if (noteEl)      noteEl.value      = '';
  const riskFlag = document.getElementById('risk-flag');
  if (riskFlag) { riskFlag.textContent = ''; riskFlag.className = 'risk-flag'; }
}

function initForm() {
  const form = document.getElementById('transaction-form');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();
    const recipient = (document.getElementById('recipient').value || '').trim();
    const amount    = parseAmount(document.getElementById('amount').value);
    const note      = (document.getElementById('note').value || '').trim();

    if (!recipient) { showToast('Please enter a recipient name.', 'warn'); return; }
    if (!amount)    { showToast('Please enter a valid amount.', 'warn'); return; }

    ACTIVE_TX = { recipient, amount, note };
    const riskResult = calculateRisk(ACTIVE_TX, MOCK_PROFILE);

    openOverlay();

    if (riskResult.level === 'LOW') {
      showLowRisk(ACTIVE_TX, riskResult);
      setSecurityState('normal');
    } else if (riskResult.level === 'MEDIUM') {
      showMediumRisk(ACTIVE_TX, riskResult);
      setSecurityState('alert');
    } else {
      showHighRisk(ACTIVE_TX, riskResult);
      setSecurityState('alert');
    }
  });
}

function initModal() {
  // Backdrop click to close
  const overlay = document.getElementById('modal-overlay');
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) { clearCountdown(); closeOverlay(); setSecurityState('normal'); }
    });
  }
  // Esc key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { clearCountdown(); closeOverlay(); setSecurityState('normal'); }
  });
}


/* ──────────────────────────────────────────────────────────────
   TOAST
   ────────────────────────────────────────────────────────────── */

function showToast(message, type = 'ok') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();
  const colors = {
    ok:     { bg: '#1f2b1e', border: 'var(--clr-ok)',     text: '#7ab870' },
    danger: { bg: '#2b1f1e', border: 'var(--clr-danger)',  text: '#c87070' },
    warn:   { bg: '#2b251e', border: 'var(--clr-accent)',  text: '#c89060' },
  };
  const c = colors[type] || colors.ok;
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  Object.assign(toast.style, {
    position: 'fixed', bottom: '28px', right: '28px',
    background: c.bg, border: `1px solid ${c.border}`, color: c.text,
    fontFamily: 'var(--font-mono)', fontSize: '0.65rem', letterSpacing: '0.1em',
    padding: '12px 20px', zIndex: '300', maxWidth: '340px',
    lineHeight: '1.5', textTransform: 'uppercase',
    opacity: '0', transition: 'opacity 0.2s ease',
  });
  toast.textContent = message;
  document.body.appendChild(toast);
  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 250); }, 3500);
}


/* ──────────────────────────────────────────────────────────────
   NAV / TICKER / SCROLL
   ────────────────────────────────────────────────────────────── */

function initNavToggle() {
  const toggle = document.getElementById('nav-toggle');
  const links  = document.getElementById('nav-links');
  if (!toggle || !links) return;
  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  links.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => { links.classList.remove('is-open'); toggle.setAttribute('aria-expanded', 'false'); });
  });
}

function initTicker() {
  const content = document.querySelector('.ticker-content');
  if (!content) return;
  content.innerHTML = content.innerHTML + content.innerHTML;
}

function initNavScroll() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;
  window.addEventListener('scroll', () => {
    navbar.style.borderBottomColor = window.scrollY > 10 ? 'var(--clr-border-lt)' : 'var(--clr-border)';
  }, { passive: true });
}

function setDefaultFormState() {
  const amountEl = document.getElementById('amount');
  if (amountEl && !amountEl.value) amountEl.value = '5,000';
}


/* ──────────────────────────────────────────────────────────────
   BOOT
   ────────────────────────────────────────────────────────────── */

document.addEventListener('DOMContentLoaded', () => {
  initTicker();
  initNavScroll();
  initNavToggle();
  renderTransactions(MOCK_TRANSACTIONS);
  updateStats();
  initRiskChecker();
  initForm();
  initModal();
  setDefaultFormState();
  setSecurityState('normal');
});

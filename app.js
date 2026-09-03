/* ═══════════════════════════════════════════════════════
   AI FRAUDSHIELD — app.js
   Mock data · UI interactions · No backend
   ═══════════════════════════════════════════════════════ */

'use strict';

/* ─────────────────────────────────────────────
   MOCK DATA
   Replace with real API responses later
   ───────────────────────────────────────────── */
const MOCK_TRANSACTIONS = [
  {
    id: 'TX-8821',
    name: 'Grocery Store',
    merchant: 'Big Bazaar, Andheri',
    amount: 2450,
    date: '2026-09-03',
    time: '09:14',
    category: 'Groceries',
    status: 'normal',
  },
  {
    id: 'TX-8820',
    name: 'Electricity Bill',
    merchant: 'MSEDCL',
    amount: 1820,
    date: '2026-09-02',
    time: '18:31',
    category: 'Utilities',
    status: 'normal',
  },
  {
    id: 'TX-8819',
    name: 'Rahul Sharma',
    merchant: 'Bank Transfer',
    amount: 5000,
    date: '2026-09-02',
    time: '14:07',
    category: 'Transfer',
    status: 'normal',
  },
  {
    id: 'TX-8818',
    name: 'Rent — August',
    merchant: 'Property Manager',
    amount: 12000,
    date: '2026-09-01',
    time: '10:00',
    category: 'Housing',
    status: 'normal',
  },
  {
    id: 'TX-8817',
    name: 'Online Shopping',
    merchant: 'Flipkart',
    amount: 3200,
    date: '2026-08-31',
    time: '22:45',
    category: 'Shopping',
    status: 'normal',
  },
];

const MOCK_PROFILE = {
  avgTransfer:    4200,
  typicalRangeMin: 500,
  typicalRangeMax: 15000,
  transactionsAnalyzed: 127,
  profileStatus: 'ESTABLISHED',
  riskMonitoring: 'ACTIVE',
};

/* ─────────────────────────────────────────────
   HELPERS
   ───────────────────────────────────────────── */
function formatAmount(n) {
  return '₹' + n.toLocaleString('en-IN');
}

function formatDatetime(date, time) {
  const d = new Date(`${date}T${time}`);
  const opts = { day: '2-digit', month: 'short', year: 'numeric' };
  return `${d.toLocaleDateString('en-IN', opts)} · ${time}`;
}

function parseAmount(str) {
  return parseFloat(str.replace(/[^0-9.]/g, '')) || 0;
}

function now() {
  const d = new Date();
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function todayISO() {
  return new Date().toISOString().split('T')[0];
}

/* ─────────────────────────────────────────────
   RENDER TRANSACTION TABLE
   ───────────────────────────────────────────── */
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

/* ─────────────────────────────────────────────
   TRANSACTION COUNT IN STATS
   ───────────────────────────────────────────── */
function initStats() {
  const countEl = document.getElementById('tx-count');
  const scanEl  = document.getElementById('last-scan');
  const timeEl  = document.getElementById('sidebar-time');

  if (countEl) countEl.textContent = MOCK_PROFILE.transactionsAnalyzed;
  if (scanEl)  scanEl.textContent  = now();
  if (timeEl)  timeEl.textContent  = now();
}

/* ─────────────────────────────────────────────
   RISK CHECKER — live as user types amount
   ───────────────────────────────────────────── */
function initRiskChecker() {
  const amountInput = document.getElementById('amount');
  const riskFlag    = document.getElementById('risk-flag');
  if (!amountInput || !riskFlag) return;

  amountInput.addEventListener('input', () => {
    const val = parseAmount(amountInput.value);
    if (!val) {
      riskFlag.textContent = '';
      riskFlag.className = 'risk-flag';
      return;
    }
    if (val > MOCK_PROFILE.typicalRangeMax) {
      riskFlag.textContent = '⚑ ABOVE TYPICAL RANGE';
      riskFlag.className = 'risk-flag flag--high';
    } else {
      riskFlag.textContent = '✓ WITHIN RANGE';
      riskFlag.className = 'risk-flag flag--ok';
    }
  });
}

/* ─────────────────────────────────────────────
   FRAUD MODAL
   ───────────────────────────────────────────── */
function openModal(recipient, amount, note) {
  const overlay = document.getElementById('modal-overlay');
  const details = document.getElementById('modal-details');
  const body    = document.getElementById('modal-body');

  if (!overlay) return;

  const isHighRisk = amount > MOCK_PROFILE.typicalRangeMax;
  const isNewRecip = true; // mock: always treat form recipient as new

  body.textContent = isHighRisk
    ? `This transfer of ${formatAmount(amount)} is ${Math.round(amount / MOCK_PROFILE.avgTransfer)}× your average transaction. FraudShield has flagged it for review.`
    : `Transfer to a new recipient detected. FraudShield is performing a quick behavioral check.`;

  details.innerHTML = `
    <div class="modal-detail-row"><span>RECIPIENT</span><span>${recipient || '—'}</span></div>
    <div class="modal-detail-row"><span>AMOUNT</span><span>${formatAmount(amount)}</span></div>
    ${note ? `<div class="modal-detail-row"><span>NOTE</span><span>${note}</span></div>` : ''}
    <div class="modal-detail-row"><span>YOUR AVG. TRANSACTION</span><span>${formatAmount(MOCK_PROFILE.avgTransfer)}</span></div>
    <div class="modal-detail-row"><span>NEW RECIPIENT?</span><span>${isNewRecip ? 'YES' : 'NO'}</span></div>
    <div class="modal-detail-row"><span>RISK LEVEL</span><span style="color:${isHighRisk ? 'var(--clr-danger)' : 'var(--clr-accent)'};">${isHighRisk ? 'HIGH' : 'MEDIUM'}</span></div>
  `;

  overlay.removeAttribute('hidden');
  document.body.style.overflow = 'hidden';
}

function closeModal() {
  const overlay = document.getElementById('modal-overlay');
  if (overlay) overlay.setAttribute('hidden', '');
  document.body.style.overflow = '';
}

function initModal() {
  const closeBtn   = document.getElementById('modal-close');
  const blockBtn   = document.getElementById('modal-block');
  const proceedBtn = document.getElementById('modal-proceed');
  const overlay    = document.getElementById('modal-overlay');

  if (closeBtn)   closeBtn.addEventListener('click', closeModal);
  if (blockBtn)   blockBtn.addEventListener('click', () => { closeModal(); showToast('Transaction blocked by FraudShield.', 'danger'); });
  if (proceedBtn) proceedBtn.addEventListener('click', () => { closeModal(); handleProceed(); });

  // close on backdrop click
  if (overlay) {
    overlay.addEventListener('click', e => {
      if (e.target === overlay) closeModal();
    });
  }

  // Esc key
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') closeModal();
  });
}

/* ─────────────────────────────────────────────
   TRANSACTION FORM SUBMIT
   ───────────────────────────────────────────── */
function handleProceed() {
  // Simulate adding the transaction to the list
  const recipientEl = document.getElementById('recipient');
  const amountEl    = document.getElementById('amount');
  const noteEl      = document.getElementById('note');

  const recipient = recipientEl ? recipientEl.value.trim() : '';
  const amount    = amountEl    ? parseAmount(amountEl.value) : 0;

  if (amount > 0 && recipient) {
    MOCK_TRANSACTIONS.unshift({
      id:       `TX-${Math.floor(Math.random() * 9000 + 1000)}`,
      name:     recipient,
      merchant: 'Bank Transfer',
      amount:   amount,
      date:     todayISO(),
      time:     now(),
      category: 'Transfer',
      status:   'normal',
    });
    MOCK_PROFILE.transactionsAnalyzed += 1;
    renderTransactions(MOCK_TRANSACTIONS.slice(0, 5));
    initStats();
    showToast('Transaction processed.', 'ok');

    // Reset form
    if (recipientEl) recipientEl.value = '';
    if (amountEl)    amountEl.value = '';
    if (noteEl)      noteEl.value = '';
    const riskFlag = document.getElementById('risk-flag');
    if (riskFlag) { riskFlag.textContent = ''; riskFlag.className = 'risk-flag'; }
  }
}

function initForm() {
  const form = document.getElementById('transaction-form');
  if (!form) return;

  form.addEventListener('submit', e => {
    e.preventDefault();

    const recipient = document.getElementById('recipient').value.trim();
    const amount    = parseAmount(document.getElementById('amount').value);

    if (!recipient) { showToast('Please enter a recipient name.', 'warn'); return; }
    if (!amount)    { showToast('Please enter a valid amount.', 'warn'); return; }

    const isHighRisk = amount > MOCK_PROFILE.typicalRangeMax;
    const isNewRecip = true; // mock

    if (isHighRisk || isNewRecip) {
      openModal(recipient, amount, document.getElementById('note').value.trim());
    } else {
      handleProceed();
    }
  });
}

/* ─────────────────────────────────────────────
   TOAST NOTIFICATION
   ───────────────────────────────────────────── */
function showToast(message, type = 'ok') {
  const existing = document.querySelector('.toast');
  if (existing) existing.remove();

  const colors = {
    ok:     { bg: '#1f2b1e', border: 'var(--clr-ok)',    text: '#7ab870' },
    danger: { bg: '#2b1f1e', border: 'var(--clr-danger)', text: '#c87070' },
    warn:   { bg: '#2b251e', border: 'var(--clr-accent)', text: '#c89060' },
  };
  const c = colors[type] || colors.ok;

  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  Object.assign(toast.style, {
    position: 'fixed',
    bottom: '28px',
    right: '28px',
    background: c.bg,
    border: `1px solid ${c.border}`,
    color: c.text,
    fontFamily: 'var(--font-mono)',
    fontSize: '0.65rem',
    letterSpacing: '0.1em',
    padding: '12px 20px',
    zIndex: '300',
    maxWidth: '340px',
    lineHeight: '1.5',
    textTransform: 'uppercase',
    opacity: '0',
    transition: 'opacity 0.2s ease',
  });
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => { toast.style.opacity = '1'; });
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 250);
  }, 3500);
}

/* ─────────────────────────────────────────────
   MOBILE NAV TOGGLE
   ───────────────────────────────────────────── */
function initNavToggle() {
  const toggle = document.getElementById('nav-toggle');
  const links  = document.getElementById('nav-links');
  if (!toggle || !links) return;

  toggle.addEventListener('click', () => {
    const open = links.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });

  // Close nav on link click (mobile)
  links.querySelectorAll('.nav-link').forEach(link => {
    link.addEventListener('click', () => {
      links.classList.remove('is-open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });
}

/* ─────────────────────────────────────────────
   TICKER DUPLICATION for seamless scroll
   ───────────────────────────────────────────── */
function initTicker() {
  const content = document.querySelector('.ticker-content');
  if (!content) return;
  // Duplicate text so the animation loops seamlessly
  content.innerHTML = content.innerHTML + content.innerHTML;
}

/* ─────────────────────────────────────────────
   SCROLL → NAVBAR BORDER EMPHASIS
   ───────────────────────────────────────────── */
function initNavScroll() {
  const navbar = document.getElementById('navbar');
  if (!navbar) return;
  window.addEventListener('scroll', () => {
    if (window.scrollY > 10) {
      navbar.style.borderBottomColor = 'var(--clr-border-lt)';
    } else {
      navbar.style.borderBottomColor = 'var(--clr-border)';
    }
  }, { passive: true });
}

/* ─────────────────────────────────────────────
   BOOT
   ───────────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', () => {
  initTicker();
  initNavScroll();
  initNavToggle();
  renderTransactions(MOCK_TRANSACTIONS);
  initStats();
  initRiskChecker();
  initForm();
  initModal();
});

const crypto = require('node:crypto');
const { createEscrow, lockFunds, submitProof, release } = require('../escrow');

const CURRENCIES = new Set(['MYZ', 'XMR']);
const DEFAULT_RELAY_RATE_MYZ = 0.001;
const DEFAULT_CACHE_RATE_MYZ = 0.0005;
const DEFAULT_XMR_RATE = 12000;
const DEFAULT_SPLIT_RATIOS = [0.6, 0.3, 0.1];

class RepeaterPaymentStore {
  constructor() { this.items = new Map(); }
  save(payment) { this.items.set(payment.id, structuredClone(payment)); return structuredClone(payment); }
  get(id) { const item = this.items.get(id); return item ? structuredClone(item) : null; }
  list() { return [...this.items.values()].map((item) => structuredClone(item)); }
  findByRepeater(repeaterId) {
    return [...this.items.values()]
      .filter((item) => item.repeaterId === repeaterId || item.participants?.some((p) => p.repeaterId === repeaterId))
      .map((item) => structuredClone(item));
  }
}

class RepeaterPaymentService {
  constructor({
    store = new RepeaterPaymentStore(),
    clock = () => new Date(),
    idGenerator = () => crypto.randomUUID(),
    relayRateMyz = DEFAULT_RELAY_RATE_MYZ,
    cacheRateMyz = DEFAULT_CACHE_RATE_MYZ,
    xmrRate = DEFAULT_XMR_RATE,
    splitRatios = DEFAULT_SPLIT_RATIOS,
  } = {}) {
    this.store = store;
    this.clock = clock;
    this.idGenerator = idGenerator;
    this.relayRateMyz = relayRateMyz;
    this.cacheRateMyz = cacheRateMyz;
    this.xmrRate = xmrRate;
    this.splitRatios = splitRatios;
  }

  createPaymentHold({ repeaterId, amount, currency, participants = [], reference = null, metadata = {} }) {
    if (!repeaterId) throw new Error('repeaterId is required');
    this.validateAmount(amount);
    if (!CURRENCIES.has(currency)) throw new Error(`currency must be one of ${[...CURRENCIES].join(', ')}`);

    const timestamp = this.clock().toISOString();
    const id = this.idGenerator();
    const escrowId = `escrow_${id}`;

    const normalizedParticipants = this.normalizeParticipants(repeaterId, participants);
    const splits = this.calculateSplits(amount, normalizedParticipants.length);

    const payment = {
      id,
      repeaterId,
      amount: Number(amount),
      currency,
      participants: normalizedParticipants.map((p, idx) => ({
        ...p,
        share: splits[idx],
        shareAmount: this.calculateShareAmount(amount, splits[idx], currency),
      })),
      reference,
      metadata,
      status: 'HELD',
      escrowId,
      txId: null,
      confirmations: 0,
      proofHash: null,
      createdAt: timestamp,
      updatedAt: timestamp,
      releasedAt: null,
    };

    createEscrow(escrowId, 'system', 'system', amount);
    return this.store.save(payment);
  }

  async submitProof(paymentId, proofHash) {
    const payment = await this.store.get(paymentId);
    if (!payment) throw new Error('Payment not found');
    if (payment.status !== 'HELD') throw new Error('Payment is not in HELD state');

    payment.proofHash = String(proofHash);
    payment.updatedAt = this.clock().toISOString();
    submitProof(payment.escrowId, proofHash);
    payment.status = 'PROOF_SUBMITTED';
    return this.store.save(payment);
  }

  async releasePayment(paymentId, caller) {
    const payment = await this.store.get(paymentId);
    if (!payment) throw new Error('Payment not found');
    if (!['HELD', 'PROOF_SUBMITTED'].includes(payment.status)) throw new Error('Payment cannot be released');

    release(payment.escrowId, caller);
    payment.status = 'RELEASED';
    payment.releasedAt = this.clock().toISOString();
    payment.updatedAt = this.clock().toISOString();
    return this.store.save(payment);
  }

  calculateRepeaterEarnings(repeaterId, { from, to } = {}) {
    const payments = this.store.findByRepeater(repeaterId);
    const filtered = payments
      .filter((p) => (from ? p.createdAt >= new Date(from).toISOString() : true))
      .filter((p) => (to ? p.createdAt <= new Date(to).toISOString() : true));

    const earnings = {
      repeaterId,
      totalPayments: filtered.length,
      totalAmountMyz: 0,
      totalAmountXmr: 0,
      byCurrency: { MYZ: 0, XMR: 0 },
      byStatus: {},
      participants: filtered.filter((p) => p.participants?.some((part) => part.repeaterId === repeaterId)),
    };

    for (const payment of filtered) {
      earnings.byStatus[payment.status] = (earnings.byStatus[payment.status] || 0) + 1;
      if (payment.currency === 'MYZ') {
        earnings.totalAmountMyz += payment.amount;
        earnings.byCurrency.MYZ += payment.amount;
      } else if (payment.currency === 'XMR') {
        earnings.totalAmountXmr += payment.amount;
        earnings.byCurrency.XMR += payment.amount;
      }
    }

    return earnings;
  }

  calculateEarningsFromActivity({ repeaterId, relayedBytes = 0, cachedBytes = 0, currency = 'MYZ' }) {
    if (!CURRENCIES.has(currency)) throw new Error(`currency must be one of ${[...CURRENCIES].join(', ')}`);
    if (relayedBytes < 0 || cachedBytes < 0) throw new Error('relayedBytes and cachedBytes must be non-negative');

    const baseRate = currency === 'XMR' ? this.xmrRate : 1;
    const relayRate = currency === 'XMR' ? this.relayRateMyz / this.xmrRate : this.relayRateMyz;
    const cacheRate = currency === 'XMR' ? this.cacheRateMyz / this.xmrRate : this.cacheRateMyz;

    const relayEarnings = Number(relayedBytes) * relayRate;
    const cacheEarnings = Number(cachedBytes) * cacheRate;
    const total = relayEarnings + cacheEarnings;

    return {
      repeaterId,
      currency,
      relayedBytes,
      cachedBytes,
      relayEarnings,
      cacheEarnings,
      totalEarnings: total,
      rates: { relayRate, cacheRate, baseRate },
    };
  }

  distributePayment({ amount, currency, participants, distributionType = 'weighted' }) {
    if (!participants || participants.length === 0) throw new Error('participants is required');
    if (!CURRENCIES.has(currency)) throw new Error(`currency must be one of ${[...CURRENCIES].join(', ')}`);
    this.validateAmount(amount);

    const totalWeight = participants.reduce((sum, p) => sum + (Number(p.weight) || 1), 0);
    const shares = participants.map((p, idx) => {
      const weight = Number(p.weight) || 1;
      const ratio = this.splitRatios[idx] || (weight / totalWeight);
      return {
        repeaterId: p.repeaterId,
        weight,
        ratio,
        amount: (amount * ratio).toFixed(8),
      };
    });

    return {
      totalAmount: amount,
      currency,
      distributionType,
      totalParticipants: participants.length,
      shares,
      distributedAt: this.clock().toISOString(),
    };
  }

  getEarningsReport({ repeaterId, from, to } = {}) {
    if (repeaterId) {
      const earnings = this.calculateRepeaterEarnings(repeaterId, { from, to });
      return {
        type: 'repeater',
        repeaterId,
        ...earnings,
        generatedAt: this.clock().toISOString(),
      };
    }

    const allPayments = this.store.list();
    const filtered = allPayments
      .filter((p) => (from ? p.createdAt >= new Date(from).toISOString() : true))
      .filter((p) => (to ? p.createdAt <= new Date(to).toISOString() : true));

    const repeaterStats = new Map();
    for (const payment of filtered) {
      for (const participant of payment.participants || []) {
        if (!repeaterStats.has(participant.repeaterId)) {
          repeaterStats.set(participant.repeaterId, { totalPayments: 0, totalAmount: 0, currency: payment.currency });
        }
        const stats = repeaterStats.get(participant.repeaterId);
        stats.totalPayments += 1;
        stats.totalAmount += Number(participant.shareAmount || 0);
      }
    }

    const totalHeld = filtered.filter((p) => p.status === 'HELD').reduce((sum, p) => sum + p.amount, 0);
    const totalReleased = filtered.filter((p) => p.status === 'RELEASED').reduce((sum, p) => sum + p.amount, 0);

    return {
      type: 'dashboard',
      totalPayments: filtered.length,
      totalHeld,
      totalReleased,
      currencyBreakdown: { MYZ: 0, XMR: 0 },
      repeaterStats: Array.from(repeaterStats.entries()).map(([repeaterId, stats]) => ({ repeaterId, ...stats })),
      generatedAt: this.clock().toISOString(),
    };
  }

  async requirePayment(id) {
    const payment = await this.store.get(id);
    if (!payment) throw new Error('Payment not found');
    return payment;
  }

  listPayments({ repeaterId, status, currency, from, to, limit = 50, offset = 0 } = {}) {
    const all = repeaterId ? this.store.findByRepeater(repeaterId) : this.store.list();
    const filtered = all
      .filter((item) => (status ? item.status === status : true))
      .filter((item) => (currency ? item.currency === currency : true))
      .filter((item) => (from ? item.createdAt >= new Date(from).toISOString() : true))
      .filter((item) => (to ? item.createdAt <= new Date(to).toISOString() : true))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    const size = Math.min(Number(limit) || 50, 200);
    const start = Math.max(Number(offset) || 0, 0);
    return { total: filtered.length, limit: size, offset: start, items: filtered.slice(start, start + size) };
  }

  normalizeParticipants(repeaterId, participants) {
    const normalized = [{ repeaterId, weight: 1 }];
    for (const p of participants || []) {
      if (p.repeaterId && p.repeaterId !== repeaterId) {
        normalized.push({ repeaterId: p.repeaterId, weight: Number(p.weight) || 1 });
      }
    }
    return normalized;
  }

  calculateSplits(amount, participantCount) {
    if (participantCount <= 0) throw new Error('participantCount must be positive');
    if (participantCount <= this.splitRatios.length) {
      return this.splitRatios.slice(0, participantCount);
    }
    const splits = [...this.splitRatios];
    const remainder = 1 - splits.reduce((a, b) => a + b, 0);
    const equalShare = remainder / (participantCount - splits.length);
    while (splits.length < participantCount) {
      splits.push(equalShare);
    }
    return splits;
  }

  calculateShareAmount(totalAmount, ratio, currency) {
    const converted = totalAmount * ratio;
    if (currency === 'XMR') {
      return Number(converted.toFixed(12));
    }
    return Number(converted.toFixed(2));
  }

  validateAmount(amount) {
    if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) throw new Error('amount must be positive');
  }
}

function createRepeaterPaymentService(options = {}) {
  const service = new RepeaterPaymentService(options);
  return service;
}

module.exports = {
  RepeaterPaymentService,
  RepeaterPaymentStore,
  createRepeaterPaymentService,
  DEFAULT_RELAY_RATE_MYZ,
  DEFAULT_CACHE_RATE_MYZ,
  DEFAULT_XMR_RATE,
  DEFAULT_SPLIT_RATIOS,
};

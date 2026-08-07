const express = require('express');
const router = express.Router();
const { createRepeaterPaymentService } = require('../services/repeaterPaymentService');

const service = createRepeaterPaymentService();

router.post('/holds', async (req, res) => {
  try {
    const { repeaterId, amount, currency, participants = [], reference, metadata } = req.body || {};
    if (!repeaterId || !amount || !currency) return res.status(400).json({ success: false, error: 'repeaterId, amount, and currency are required' });
    const payment = await service.createPaymentHold({ repeaterId, amount, currency, participants, reference, metadata });
    res.status(201).json({ success: true, data: payment });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/:id/proof', async (req, res) => {
  try {
    const { proofHash } = req.body || {};
    if (!proofHash) return res.status(400).json({ success: false, error: 'proofHash is required' });
    const payment = await service.submitProof(req.params.id, proofHash);
    res.json({ success: true, data: payment });
  } catch (err) {
    const notFound = err.message === 'Payment not found';
    res.status(notFound ? 404 : 400).json({ success: false, error: err.message });
  }
});

router.post('/:id/release', async (req, res) => {
  try {
    const { caller } = req.body || {};
    const payment = await service.releasePayment(req.params.id, caller || 'system');
    res.json({ success: true, data: payment });
  } catch (err) {
    const notFound = err.message === 'Payment not found';
    res.status(notFound ? 404 : 400).json({ success: false, error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const page = service.listPayments(req.query);
    res.json({ success: true, ...page, items: page.items });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/earnings/activity', (req, res) => {
  try {
    const { repeaterId, relayedBytes, cachedBytes, currency = 'MYZ' } = req.query || {};
    if (!repeaterId) return res.status(400).json({ success: false, error: 'repeaterId is required' });
    const result = service.calculateEarningsFromActivity({
      repeaterId,
      relayedBytes: Number(relayedBytes) || 0,
      cachedBytes: Number(cachedBytes) || 0,
      currency,
    });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/earnings/:repeaterId', (req, res) => {
  try {
    const { from, to } = req.query || {};
    const earnings = service.calculateRepeaterEarnings(req.params.repeaterId, { from, to });
    res.json({ success: true, data: earnings });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/report', (req, res) => {
  try {
    const { repeaterId, from, to } = req.query || {};
    const report = service.getEarningsReport({ repeaterId, from, to });
    res.json({ success: true, data: report });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/distribute', (req, res) => {
  try {
    const { amount, currency, participants, distributionType } = req.body || {};
    if (!amount || !currency || !participants) return res.status(400).json({ success: false, error: 'amount, currency, and participants are required' });
    const result = service.distributePayment({ amount, currency, participants, distributionType });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const payment = await service.requirePayment(req.params.id);
    res.json({ success: true, data: payment });
  } catch (err) {
    res.status(404).json({ success: false, error: err.message });
  }
});

module.exports = router;

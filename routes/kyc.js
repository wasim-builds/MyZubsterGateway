const express = require('express');
const router = express.Router();
const KycVerification = require('../models/KycVerification');

const MOCK_VERIFICATION = {
  base: { score: 1, checks: ['email_verified', 'phone_verified'] },
  verified: { score: 2, checks: ['email_verified', 'phone_verified', 'id_document', 'selfie_match'] },
  institutional: { score: 3, checks: ['email_verified', 'phone_verified', 'id_document', 'selfie_match', 'business_registration', 'ubo_declaration'] }
};

router.post('/register', async (req, res) => {
  try {
    const { userId, walletAddress, documents } = req.body;

    if (!userId || !walletAddress) {
      return res.status(400).json({ error: 'userId and walletAddress are required' });
    }

    const existing = await KycVerification.findOne({ userId });
    if (existing) {
      return res.status(409).json({ error: 'User already registered for KYC', verificationId: existing._id });
    }

    const verification = new KycVerification({
      userId,
      walletAddress,
      documents: documents || [],
      provider: 'mock',
      providerRef: `mock-${Date.now()}`,
      status: 'pending'
    });

    await verification.save();
    res.status(201).json({ message: 'KYC registration submitted', verification });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/verify/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const { level, documents, metadata } = req.body;

    const validLevels = ['base', 'verified', 'institutional'];
    if (!validLevels.includes(level)) {
      return res.status(400).json({ error: 'Invalid verification level', validLevels });
    }

    const verification = await KycVerification.findOne({ userId });
    if (!verification) {
      return res.status(404).json({ error: 'User not registered for KYC' });
    }

    verification.level = level;
    verification.status = 'approved';
    verification.provider = 'mock';
    verification.providerRef = `mock-verify-${Date.now()}`;
    if (documents) verification.documents = documents;
    if (metadata) verification.metadata = metadata;
    verification.reviewedAt = Date.now();

    await verification.save();
    res.json({ message: 'Verification approved', verification });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/status/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    const verification = await KycVerification.findOne({ userId });

    if (!verification) {
      return res.status(404).json({ error: 'No KYC record found' });
    }

    const capabilities = MOCK_VERIFICATION[verification.level] || MOCK_VERIFICATION.base;
    res.json({
      userId: verification.userId,
      level: verification.level,
      status: verification.status,
      capabilities,
      provider: verification.provider,
      updatedAt: verification.updatedAt
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/pending', async (req, res) => {
  try {
    const pending = await KycVerification.find({ status: 'pending' })
      .sort({ createdAt: -1 })
      .limit(100);

    res.json({ count: pending.length, pending });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/approve/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { level, reviewedBy } = req.body;

    const validLevels = ['base', 'verified', 'institutional'];
    if (!validLevels.includes(level)) {
      return res.status(400).json({ error: 'Invalid verification level', validLevels });
    }

    const verification = await KycVerification.findById(id);
    if (!verification) {
      return res.status(404).json({ error: 'Verification record not found' });
    }

    verification.level = level;
    verification.status = 'approved';
    verification.reviewedBy = reviewedBy || 'admin';
    verification.reviewedAt = Date.now();
    await verification.save();

    res.json({ message: 'Verification approved', verification });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/reject/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reviewedBy, reason } = req.body;

    const verification = await KycVerification.findById(id);
    if (!verification) {
      return res.status(404).json({ error: 'Verification record not found' });
    }

    verification.status = 'rejected';
    verification.reviewedBy = reviewedBy || 'admin';
    verification.reviewedAt = Date.now();
    verification.metadata = { ...verification.metadata, rejectionReason: reason };
    await verification.save();

    res.json({ message: 'Verification rejected', verification });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;

const KycVerification = require('../models/KycVerification');

const LEVEL_REQUIREMENTS = {
  base: (verification) => verification.status === 'approved',
  verified: (verification) => verification.status === 'approved' && ['verified', 'institutional'].includes(verification.level),
  institutional: (verification) => verification.status === 'approved' && verification.level === 'institutional'
};

const kycCheck = (requiredLevel = 'base') => {
  return async (req, res, next) => {
    try {
      const walletAddress = req.headers['x-wallet-address'] || req.query.walletAddress || req.body.walletAddress;

      if (!walletAddress) {
        return res.status(401).json({ error: 'Wallet address required for KYC verification' });
      }

      const verification = await KycVerification.findOne({ walletAddress });
      if (!verification) {
        return res.status(403).json({ error: 'KYC verification required', currentLevel: null });
      }

      const check = LEVEL_REQUIREMENTS[requiredLevel];
      if (!check(verification)) {
        return res.status(403).json({
          error: `KYC level ${requiredLevel} required`,
          currentLevel: verification.level,
          status: verification.status
        });
      }

      req.kyc = verification;
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  };
};

module.exports = { kycCheck, LEVEL_REQUIREMENTS };

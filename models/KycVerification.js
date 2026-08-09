const mongoose = require('mongoose');

const KycVerificationSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  walletAddress: { type: String, required: true },
  level: { type: String, enum: ['base', 'verified', 'institutional'], default: 'base' },
  status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending' },
  provider: { type: String, default: 'mock' },
  providerRef: { type: String },
  documents: [{
    type: { type: String },
    url: { type: String },
    uploadedAt: { type: Date, default: Date.now }
  }],
  metadata: { type: mongoose.Schema.Types.Mixed },
  reviewedBy: { type: String },
  reviewedAt: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
});

KycVerificationSchema.pre('save', function(next) {
  this.updatedAt = Date.now();
  next();
});

module.exports = mongoose.model('KycVerification', KycVerificationSchema);

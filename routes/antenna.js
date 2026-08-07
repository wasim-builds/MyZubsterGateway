const express = require('express');
const router = express.Router();
const { createAntennaService } = require('../services/antennaService');

const service = createAntennaService();

router.post('/register', (req, res) => {
  try {
    const { id, capabilities = [], metadata = {} } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });
    const node = service.registerNode({ id, capabilities, metadata });
    res.status(201).json({ success: true, data: node });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/status', (req, res) => {
  try {
    const nodes = service.listNodes();
    res.json({ success: true, data: nodes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/status/:id', (req, res) => {
  try {
    const node = service.getNode(req.params.id);
    if (!node) return res.status(404).json({ success: false, error: 'Antenna not found' });
    res.json({ success: true, data: node });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/command', (req, res) => {
  try {
    const { nodeId, command, params = {} } = req.body || {};
    if (!nodeId || !command) return res.status(400).json({ success: false, error: 'nodeId and command are required' });
    const result = service.dispatchCommand(nodeId, command, params);
    if (!result) return res.status(404).json({ success: false, error: 'Antenna not found' });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/ping', (req, res) => {
  try {
    const { nodeId } = req.body || {};
    if (!nodeId) return res.status(400).json({ success: false, error: 'nodeId is required' });
    const result = service.recordPing(nodeId);
    if (!result) return res.status(404).json({ success: false, error: 'Antenna not found' });
    res.json({ success: true, data: result });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/escrow/create', (req, res) => {
  try {
    const { nodeId, amount, description } = req.body || {};
    if (!nodeId || !amount) return res.status(400).json({ success: false, error: 'nodeId and amount are required' });
    const escrowId = service.createAntennaEscrow(nodeId, amount, description);
    res.status(201).json({ success: true, data: { escrowId, nodeId, amount, description } });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/escrow/:escrowId/proof', (req, res) => {
  try {
    const { proofHash } = req.body || {};
    if (!proofHash) return res.status(400).json({ success: false, error: 'proofHash is required' });
    service.submitAntennaProof(req.params.escrowId, proofHash);
    res.json({ success: true, message: 'Proof submitted' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/escrow/:escrowId/release', (req, res) => {
  try {
    service.releaseAntennaPayment(req.params.escrowId);
    res.json({ success: true, message: 'Payment released' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/:id', (req, res) => {
  try {
    const node = service.unregisterNode(req.params.id);
    if (!node) return res.status(404).json({ success: false, error: 'Antenna not found' });
    res.json({ success: true, data: node });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

module.exports = router;

const express = require('express');
const router = express.Router();
const { createRepeaterService } = require('../services/repeaterService');

const service = createRepeaterService();

router.post('/register', (req, res) => {
  try {
    const { id, address, metadata } = req.body || {};
    if (!id || !address) return res.status(400).json({ success: false, error: 'id and address are required' });
    const node = service.registerNode({ id, address, metadata });
    res.status(201).json({ success: true, data: node });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/neighbors', (req, res) => {
  try {
    const { id, neighbors } = req.body || {};
    if (!id) return res.status(400).json({ success: false, error: 'id is required' });
    const node = service.updateNodeNeighbors(id, neighbors || []);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    res.json({ success: true, data: node });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/heartbeat', (req, res) => {
  try {
    const { nodeId } = req.body || {};
    if (!nodeId) return res.status(400).json({ success: false, error: 'nodeId is required' });
    service.recordHeartbeat(nodeId);
    res.json({ success: true, message: 'Heartbeat recorded' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/cache', (req, res) => {
  try {
    const { key, data } = req.body || {};
    if (!key) return res.status(400).json({ success: false, error: 'key is required' });
    const cached = service.cacheSensorData(key, data);
    res.json({ success: true, data: cached });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/cache/:key', (req, res) => {
  try {
    const data = service.getCachedSensorData(req.params.key);
    if (!data) return res.status(404).json({ success: false, error: 'Cache miss' });
    res.json({ success: true, data });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/health', (req, res) => {
  try {
    const health = service.getHealth();
    res.json({ success: true, data: health });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/nodes', (req, res) => {
  try {
    const nodes = service.listNodes();
    res.json({ success: true, data: nodes });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/nodes/:id', (req, res) => {
  try {
    const node = service.getNode(req.params.id);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    res.json({ success: true, data: node });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/route', (req, res) => {
  try {
    const { from, to, payload } = req.body || {};
    if (!from || !to) return res.status(400).json({ success: false, error: 'from and to are required' });
    const route = service.routeMessage(from, to, payload);
    if (!route) return res.status(404).json({ success: false, error: 'No route available' });
    res.json({ success: true, data: route });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/path/:from/:to', (req, res) => {
  try {
    const path = service.findBestPath(req.params.from, req.params.to);
    if (!path) return res.status(404).json({ success: false, error: 'No path available' });
    res.json({ success: true, data: path });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/failover/:id', (req, res) => {
  try {
    const node = service.failoverNode(req.params.id);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    res.json({ success: true, data: node });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/recover/:id', (req, res) => {
  try {
    const node = service.recoverNode(req.params.id);
    if (!node) return res.status(404).json({ success: false, error: 'Node not found' });
    res.json({ success: true, data: node });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/cache/:key', (req, res) => {
  try {
    service.invalidateSensorCache(req.params.key);
    res.json({ success: true, message: 'Cache invalidated' });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.delete('/cache', (req, res) => {
  try {
    service.clearSensorCache();
    res.json({ success: true, message: 'Cache cleared' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/cache/stats', (req, res) => {
  try {
    const stats = service.getCacheStats();
    res.json({ success: true, data: stats });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

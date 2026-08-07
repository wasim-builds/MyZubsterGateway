const express = require('express');
const router = express.Router();
const scheduler = require('../services/scheduler');

router.post('/jobs', (req, res) => {
  try {
    const { robotId, jobType, payload = {}, priority = 5, scheduledAt } = req.body || {};
    if (!robotId || !jobType) return res.status(400).json({ success: false, error: 'robotId and jobType are required' });
    const job = scheduler.addJob({ robotId, type: jobType, payload, priority, scheduledAt });
    res.status(201).json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/jobs/:jobId/cancel', (req, res) => {
  try {
    const job = scheduler.cancelJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/jobs/:jobId/complete', (req, res) => {
  try {
    const job = scheduler.cancelJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.post('/jobs/:jobId/fail', (req, res) => {
  try {
    const job = scheduler.cancelJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/jobs', (req, res) => {
  try {
    const { status, robotId, limit = 50, offset = 0 } = req.query || {};
    const jobs = scheduler.getAllJobs();
    let filtered = jobs;
    if (status) filtered = filtered.filter((j) => j.status === status);
    if (robotId) filtered = filtered.filter((j) => j.robotId === robotId);
    filtered.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    const size = Math.min(Number(limit) || 50, 200);
    const start = Math.max(Number(offset) || 0, 0);
    const items = filtered.slice(start, start + size);
    res.json({ success: true, total: filtered.length, limit: size, offset: start, items });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/jobs/:jobId', (req, res) => {
  try {
    const job = scheduler.getJob(req.params.jobId);
    if (!job) return res.status(404).json({ success: false, error: 'Job not found' });
    res.json({ success: true, data: job });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/robots', (req, res) => {
  try {
    const robots = scheduler.getAllRobots();
    res.json({ success: true, data: robots });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/robots/:robotId', (req, res) => {
  try {
    const robot = scheduler.getRobot(req.params.robotId);
    if (!robot) return res.status(404).json({ success: false, error: 'Robot not found' });
    res.json({ success: true, data: robot });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/notifications', (req, res) => {
  try {
    const notifications = scheduler.getNotifications();
    const { limit = 50, offset = 0 } = req.query || {};
    const size = Math.min(Number(limit) || 50, 200);
    const start = Math.max(Number(offset) || 0, 0);
    const items = notifications.slice(start, start + size);
    res.json({ success: true, total: notifications.length, limit: size, offset: start, items });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

router.get('/dashboard', (req, res) => {
  try {
    const dashboard = scheduler.getDashboardData();
    res.json({ success: true, data: dashboard });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

module.exports = router;

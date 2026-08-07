// services/antennaService.js - MyZubster Antenna Protocol Gateway
const escrow = require('../escrow');

const DEFAULT_PING_TIMEOUT_MS = 30000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;

class AntennaNodeStore {
  constructor() {
    this.nodes = new Map();
  }

  upsert({ id, status = 'offline', metadata = {}, capabilities = [] }) {
    const existing = this.nodes.get(id);
    const node = {
      id,
      status,
      metadata,
      capabilities,
      lastPing: existing?.lastPing || null,
      registeredAt: existing?.registeredAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this.nodes.set(id, node);
    return structuredClone(node);
  }

  get(id) {
    const node = this.nodes.get(id);
    return node ? structuredClone(node) : null;
  }

  list() {
    return Array.from(this.nodes.values()).map((node) => structuredClone(node));
  }

  remove(id) {
    const node = this.nodes.get(id);
    this.nodes.delete(id);
    return node ? structuredClone(node) : null;
  }

  updateStatus(id, status) {
    const node = this.nodes.get(id);
    if (!node) return null;
    node.status = status;
    node.updatedAt = new Date().toISOString();
    this.nodes.set(id, node);
    return structuredClone(node);
  }

  recordPing(id) {
    const node = this.nodes.get(id);
    if (!node) return null;
    node.lastPing = new Date().toISOString();
    node.status = 'online';
    node.updatedAt = new Date().toISOString();
    this.nodes.set(id, node);
    return structuredClone(node);
  }

  getStaleIds(now = Date.now(), ttlMs = DEFAULT_PING_TIMEOUT_MS) {
    const stale = [];
    for (const [id, node] of this.nodes) {
      if (!node.lastPing) continue;
      const last = new Date(node.lastPing).getTime();
      if (now - last > ttlMs) stale.push(id);
    }
    return stale;
  }
}

class AntennaService {
  constructor({ pingTimeoutMs = DEFAULT_PING_TIMEOUT_MS, heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS } = {}) {
    this.nodes = new AntennaNodeStore();
    this.pingTimeoutMs = pingTimeoutMs;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.escrows = new Map();
    this.failedNodes = new Set();
    this.timer = null;
    this.loggers = { info: console.log, warn: console.warn, error: console.error, debug: console.debug };
  }

  registerNode(id, metadata = {}, capabilities = []) {
    if (!id) throw new Error('Node id is required');
    const node = this.nodes.upsert({ id, metadata, capabilities });
    this.loggers.info(`[Antenna] Node registered: ${id}`);
    return node;
  }

  unregisterNode(id) {
    const node = this.nodes.remove(id);
    this.escrows.clear();
    this.failedNodes.delete(id);
    if (node) this.loggers.info(`[Antenna] Node unregistered: ${id}`);
    return node;
  }

  updateStatus(id, status) {
    const node = this.nodes.updateStatus(id, status);
    if (!node) this.loggers.warn(`[Antenna] updateStatus failed: node ${id} not found`);
    else this.loggers.debug(`[Antenna] Status updated for ${id}: ${status}`);
    return node;
  }

  recordPing(id) {
    const node = this.nodes.recordPing(id);
    if (!node) this.loggers.warn(`[Antenna] recordPing failed: node ${id} not found`);
    else this.loggers.debug(`[Antenna] Ping recorded for ${id}`);
    return node;
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  listNodes() {
    return this.nodes.list();
  }

  dispatchCommand(nodeId, command, payload = {}) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      this.loggers.warn(`[Antenna] dispatchCommand failed: node ${nodeId} not found`);
      return null;
    }
    if (node.status === 'offline') {
      this.loggers.warn(`[Antenna] dispatchCommand failed: node ${nodeId} is offline`);
      return null;
    }
    const message = {
      type: 'command',
      nodeId,
      command,
      payload,
      timestamp: new Date().toISOString(),
      protocol: 'mqtt/json',
    };
    this.loggers.info(`[Antenna] Command dispatched to ${nodeId}: ${command}`);
    return message;
  }

  handleIncomingMessage(nodeId, message) {
    if (!message || typeof message !== 'object') {
      throw new Error('Invalid message format: expected JSON object');
    }
    const node = this.nodes.get(nodeId);
    if (!node) {
      this.loggers.warn(`[Antenna] handleIncomingMessage failed: node ${nodeId} not found`);
      return null;
    }
    const response = {
      nodeId,
      receivedAt: new Date().toISOString(),
      ack: message.id || null,
      type: 'response',
      protocol: 'mqtt/json',
    };
    if (message.type === 'ping') {
      this.recordPing(nodeId);
      response.status = 'pong';
      response.nodeStatus = node.status;
    } else if (message.type === 'status_update') {
      this.updateStatus(nodeId, message.status || node.status);
      response.status = 'updated';
    } else if (message.type === 'data') {
      response.data = message.data;
      response.status = 'received';
    } else if (message.type === 'command_ack') {
      response.command = message.command;
      response.status = 'acknowledged';
    } else {
      response.status = 'unknown_type';
    }
    this.loggers.debug(`[Antenna] Message handled from ${nodeId}: ${message.type}`);
    return response;
  }

  createAntennaEscrow(nodeId, clientId, amount) {
    const node = this.nodes.get(nodeId);
    if (!node) {
      this.loggers.warn(`[Antenna] createAntennaEscrow failed: node ${nodeId} not found`);
      return null;
    }
    const escrowId = `antenna-${nodeId}-${Date.now()}`;
    const result = escrow.createEscrow(escrowId, clientId, nodeId, amount);
    if (result) {
      this.escrows.set(escrowId, { nodeId, clientId, amount, status: 'LOCKED' });
      this.loggers.info(`[Antenna] Escrow created for node ${nodeId}: ${escrowId}`);
    }
    return escrowId;
  }

  submitAntennaProof(escrowId, proof) {
    const escrowRecord = this.escrows.get(escrowId);
    if (!escrowRecord) {
      this.loggers.warn(`[Antenna] submitAntennaProof failed: escrow ${escrowId} not found`);
      return false;
    }
    const result = escrow.submitProof(escrowId, proof);
    if (result) {
      escrowRecord.status = 'PROOF_SUBMITTED';
      escrowRecord.proof = proof;
      this.escrows.set(escrowId, escrowRecord);
      this.loggers.info(`[Antenna] Proof submitted for escrow ${escrowId}`);
    }
    return result;
  }

  releaseAntennaPayment(escrowId, caller) {
    const escrowRecord = this.escrows.get(escrowId);
    if (!escrowRecord) {
      this.loggers.warn(`[Antenna] releaseAntennaPayment failed: escrow ${escrowId} not found`);
      return false;
    }
    const result = escrow.release(escrowId, caller);
    if (result) {
      escrowRecord.status = 'RELEASED';
      this.escrows.set(escrowId, escrowRecord);
      this.loggers.info(`[Antenna] Payment released for escrow ${escrowId}`);
    }
    return result;
  }

  getHealth() {
    const allNodes = this.nodes.list();
    const online = allNodes.filter((n) => n.status === 'online').length;
    const stale = this.nodes.getStaleIds();
    return {
      totalNodes: allNodes.length,
      online,
      offline: allNodes.filter((n) => n.status === 'offline').length,
      stale: stale.length,
      activeEscrows: this.escrows.size,
    };
  }

  detectStaleNodes() {
    const staleIds = this.nodes.getStaleIds(Date.now(), this.pingTimeoutMs);
    const stale = staleIds.map((id) => {
      const node = this.nodes.get(id);
      if (node) this.nodes.updateStatus(id, 'stale');
      return node;
    });
    return stale;
  }

  startHealthMonitoring() {
    this.stopHealthMonitoring();
    this.timer = setInterval(() => {
      const now = Date.now();
      const nodes = this.nodes.list();
      const staleIds = this.nodes.getStaleIds(now, this.pingTimeoutMs);
      for (const id of staleIds) {
        this.failedNodes.add(id);
        this.nodes.updateStatus(id, 'failed');
        this.loggers.error(`[Antenna] Node failure detected: ${id}`);
      }
      for (const node of nodes) {
        const last = new Date(node.lastPing).getTime();
        if (node.lastPing && now - last <= this.pingTimeoutMs && this.failedNodes.has(node.id)) {
          this.failedNodes.delete(node.id);
          this.nodes.updateStatus(node.id, 'online');
          this.loggers.info(`[Antenna] Node recovered: ${node.id}`);
        }
      }
    }, this.heartbeatIntervalMs);
    this.loggers.info('[Antenna] Health monitoring started');
  }

  stopHealthMonitoring() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.loggers.info('[Antenna] Health monitoring stopped');
  }

  failoverNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    this.failedNodes.add(nodeId);
    this.nodes.updateStatus(nodeId, 'failed');
    this.loggers.warn(`[Antenna] Manual failover for node: ${nodeId}`);
    return structuredClone(node);
  }

  recoverNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    this.failedNodes.delete(nodeId);
    this.nodes.updateStatus(nodeId, 'online');
    this.recordPing(nodeId);
    this.loggers.info(`[Antenna] Node manually recovered: ${nodeId}`);
    return structuredClone(node);
  }
}

function createAntennaService(options = {}) {
  const service = new AntennaService(options);
  return service;
}

module.exports = { AntennaService, createAntennaService, DEFAULT_PING_TIMEOUT_MS, DEFAULT_HEARTBEAT_INTERVAL_MS };

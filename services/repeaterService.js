const DEFAULT_NODE_TTL_MS = 30000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 5000;
const DEFAULT_HEARTBEAT_TIMEOUT_MS = 15000;
const DEFAULT_CACHE_TTL_MS = 60000;
const DEFAULT_MAX_CACHE_ITEMS = 1000;
const DEFAULT_MAX_HOPS = 10;

class RepeaterNodeStore {
  constructor() {
    this.nodes = new Map();
  }

  upsert({ id, address, status = 'online', metadata = {} }) {
    const existing = this.nodes.get(id);
    const node = {
      id,
      address: String(address),
      status,
      metadata,
      neighbors: existing?.neighbors ? new Map(existing.neighbors) : new Map(),
      addedAt: existing?.addedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastSeen: new Date().toISOString(),
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
    node.lastSeen = new Date().toISOString();
    this.nodes.set(id, node);
    return structuredClone(node);
  }

  touch(id) {
    const node = this.nodes.get(id);
    if (!node) return null;
    node.lastSeen = new Date().toISOString();
    this.nodes.set(id, node);
    return structuredClone(node);
  }

  setNeighbors(id, neighbors) {
    const node = this.nodes.get(id);
    if (!node) return null;
    node.neighbors = new Map(
      Array.isArray(neighbors)
        ? neighbors.map((n) => [String(n.nodeId), Number(n.latencyMs) || 0])
        : []
    );
    node.updatedAt = new Date().toISOString();
    this.nodes.set(id, node);
    return structuredClone(node);
  }

  getNeighbors(id) {
    const node = this.nodes.get(id);
    if (!node) return [];
    return Array.from(node.neighbors.entries()).map(([nodeId, latencyMs]) => ({ nodeId, latencyMs }));
  }

  getAll() {
    return this.list();
  }

  size() {
    return this.nodes.size;
  }

  clear() {
    this.nodes.clear();
  }
}

class SensorCacheStore {
  constructor({ ttlMs = DEFAULT_CACHE_TTL_MS, maxItems = DEFAULT_MAX_CACHE_ITEMS } = {}) {
    this.ttlMs = ttlMs;
    this.maxItems = maxItems;
    this.cache = new Map();
  }

  set(key, value) {
    const entry = {
      value: structuredClone(value),
      cachedAt: Date.now(),
      expiresAt: Date.now() + this.ttlMs,
    };
    if (this.cache.size >= this.maxItems && !this.cache.has(key)) {
      const oldest = Array.from(this.cache.entries()).sort((a, b) => a[1].cachedAt - b[1].cachedAt)[0];
      if (oldest) this.cache.delete(oldest[0]);
    }
    this.cache.set(key, entry);
    return structuredClone(entry.value);
  }

  get(key) {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }
    return structuredClone(entry.value);
  }

  has(key) {
    const entry = this.cache.get(key);
    if (!entry) return false;
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return false;
    }
    return true;
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  prune() {
    const now = Date.now();
    for (const [key, entry] of this.cache) {
      if (now > entry.expiresAt) this.cache.delete(key);
    }
  }

  size() {
    return this.cache.size;
  }

  keys() {
    return Array.from(this.cache.keys());
  }
}

class HealthMonitor {
  constructor({ heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS, nodeTtlMs = DEFAULT_NODE_TTL_MS } = {}) {
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.heartbeatTimeoutMs = heartbeatTimeoutMs;
    this.nodeTtlMs = nodeTtlMs;
    this.heartbeats = new Map();
    this.onFailureCallbacks = [];
    this.onRecoveryCallbacks = [];
    this.timer = null;
  }

  recordHeartbeat(nodeId) {
    this.heartbeats.set(nodeId, Date.now());
  }

  getLastHeartbeat(nodeId) {
    return this.heartbeats.get(nodeId) || null;
  }

  isAlive(nodeId, now = Date.now()) {
    const last = this.heartbeats.get(nodeId);
    if (!last) return false;
    return now - last <= this.heartbeatTimeoutMs;
  }

  detectFailures(nodeIds, now = Date.now()) {
    const failed = [];
    for (const id of nodeIds) {
      if (!this.isAlive(id, now)) {
        failed.push(id);
      }
    }
    return failed;
  }

  onFailure(callback) {
    this.onFailureCallbacks.push(callback);
  }

  onRecovery(callback) {
    this.onRecoveryCallbacks.push(callback);
  }

  start(checkNodes) {
    this.stop();
    this.timer = setInterval(() => {
      const now = Date.now();
      const nodes = typeof checkNodes === 'function' ? checkNodes() : [];
      const failed = this.detectFailures(nodes.map((n) => n.id), now);
      for (const id of failed) {
        for (const cb of this.onFailureCallbacks) cb(id, now);
      }
      for (const node of nodes) {
        const last = this.getLastHeartbeat(node.id);
        if (last && now - last <= this.heartbeatTimeoutMs && node.status === 'failed') {
          for (const cb of this.onRecoveryCallbacks) cb(node.id, now);
        }
      }
    }, this.heartbeatIntervalMs);
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}

class MeshRouter {
  constructor(nodeStore) {
    this.nodeStore = nodeStore;
  }

  findPath(sourceId, destinationId, { maxHops = DEFAULT_MAX_HOPS } = {}) {
    const source = this.nodeStore.get(sourceId);
    const destination = this.nodeStore.get(destinationId);
    if (!source || !destination) return null;
    if (sourceId === destinationId) return [sourceId];

    const distances = new Map();
    const previous = new Map();
    const unvisited = new Set();

    for (const node of this.nodeStore.getAll()) {
      distances.set(node.id, Infinity);
      unvisited.add(node.id);
    }
    distances.set(sourceId, 0);

    while (unvisited.size > 0) {
      let current = null;
      let currentDist = Infinity;
      for (const id of unvisited) {
        const d = distances.get(id);
        if (d < currentDist) {
          currentDist = d;
          current = id;
        }
      }
      if (!current || current === destinationId) break;
      if (currentDist === Infinity) break;

      unvisited.delete(current);
      const neighbors = this.nodeStore.getNeighbors(current);
      for (const edge of neighbors) {
        if (!unvisited.has(edge.nodeId)) continue;
        const weight = Number.isFinite(edge.latencyMs) ? edge.latencyMs : 1;
        const alt = currentDist + weight;
        if (alt < distances.get(edge.nodeId)) {
          distances.set(edge.nodeId, alt);
          previous.set(edge.nodeId, current);
        }
      }
    }

    const path = [];
    let u = destinationId;
    while (previous.has(u)) {
      path.unshift(u);
      u = previous.get(u);
    }
    if (path.length === 0 || path[0] !== sourceId) return null;
    if (path.length > maxHops) return null;
    return [sourceId, ...path];
  }

  findBestPath(sourceId, destinationId, options = {}) {
    const path = this.findPath(sourceId, destinationId, options);
    if (!path) return null;
    const segments = [];
    for (let i = 0; i < path.length - 1; i += 1) {
      const from = path[i];
      const to = path[i + 1];
      const neighbors = this.nodeStore.getNeighbors(from);
      const edge = neighbors.find((n) => n.nodeId === to);
      segments.push({ from, to, latencyMs: edge ? edge.latencyMs : null });
    }
    return { path, segments, hopCount: segments.length };
  }

  routeMessage({ from, to, payload, maxHops = DEFAULT_MAX_HOPS } = {}) {
    const path = this.findBestPath(from, to, { maxHops });
    if (!path) return null;
    return {
      from,
      to,
      payload,
      path: path.path,
      segments: path.segments,
      hopCount: path.hopCount,
      routedAt: new Date().toISOString(),
    };
  }
}

class RepeaterService {
  constructor({ nodeTtlMs = DEFAULT_NODE_TTL_MS, heartbeatIntervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS, heartbeatTimeoutMs = DEFAULT_HEARTBEAT_TIMEOUT_MS, cacheTtlMs = DEFAULT_CACHE_TTL_MS, maxCacheItems = DEFAULT_MAX_CACHE_ITEMS } = {}) {
    this.nodes = new RepeaterNodeStore();
    this.cache = new SensorCacheStore({ ttlMs: cacheTtlMs, maxItems: maxCacheItems });
    this.router = new MeshRouter(this.nodes);
    this.health = new HealthMonitor({ heartbeatIntervalMs, heartbeatTimeoutMs, nodeTtlMs });
    this.failedNodes = new Set();
    this.loggers = { info: console.log, warn: console.warn, error: console.error, debug: console.debug };
  }

  registerNode({ id, address, metadata = {} }) {
    const node = this.nodes.upsert({ id, address, metadata });
    this.loggers.info(`[Repeater] Node registered: ${id} at ${address}`);
    return node;
  }

  unregisterNode(id) {
    const node = this.nodes.remove(id);
    this.cache.clear();
    this.failedNodes.delete(id);
    this.loggers.info(`[Repeater] Node unregistered: ${id}`);
    return node;
  }

  updateNodeNeighbors(id, neighbors) {
    const node = this.nodes.setNeighbors(id, neighbors);
    if (!node) {
      this.loggers.warn(`[Repeater] updateNodeNeighbors failed: node ${id} not found`);
      return null;
    }
    this.loggers.debug(`[Repeater] Neighbors updated for ${id}: ${neighbors.length} entries`);
    return node;
  }

  recordHeartbeat(nodeId) {
    this.health.recordHeartbeat(nodeId);
    const node = this.nodes.touch(nodeId);
    if (node) {
      this.nodes.updateStatus(nodeId, 'online');
    }
  }

  getNode(id) {
    return this.nodes.get(id);
  }

  listNodes() {
    return this.nodes.list();
  }

  cacheSensorData(key, data) {
    const cached = this.cache.set(key, data);
    this.loggers.debug(`[Repeater] Cached sensor data: ${key}`);
    return cached;
  }

  getCachedSensorData(key) {
    const data = this.cache.get(key);
    if (data) {
      this.loggers.debug(`[Repeater] Cache hit: ${key}`);
    } else {
      this.loggers.debug(`[Repeater] Cache miss: ${key}`);
    }
    return data;
  }

  invalidateSensorCache(key) {
    this.cache.delete(key);
    this.loggers.debug(`[Repeater] Cache invalidated: ${key}`);
  }

  clearSensorCache() {
    this.cache.clear();
    this.loggers.info('[Repeater] Sensor cache cleared');
  }

  routeMessage(from, to, payload, options = {}) {
    const result = this.router.routeMessage({ from, to, payload, ...options });
    if (!result) {
      this.loggers.warn(`[Repeater] No route from ${from} to ${to}`);
      return null;
    }
    this.loggers.info(`[Repeater] Routed message from ${from} to ${to} via ${result.path.join(' -> ')} (${result.hopCount} hops)`);
    return result;
  }

  findBestPath(sourceId, destinationId, options = {}) {
    const path = this.router.findBestPath(sourceId, destinationId, options);
    if (!path) {
      this.loggers.warn(`[Repeater] No path from ${sourceId} to ${destinationId}`);
      return null;
    }
    this.loggers.info(`[Repeater] Best path from ${sourceId} to ${destinationId}: ${path.path.join(' -> ')}`);
    return path;
  }

  getCacheStats() {
    return {
      size: this.cache.size(),
      keys: this.cache.keys(),
      ttlMs: this.cache.ttlMs,
    };
  }

  getHealth() {
    const allNodes = this.nodes.list();
    const online = allNodes.filter((n) => n.status === 'online' && this.health.isAlive(n.id)).length;
    const failed = allNodes.filter((n) => this.failedNodes.has(n.id)).length;
    return {
      totalNodes: allNodes.length,
      online,
      failed,
      cacheSize: this.cache.size(),
    };
  }

  startHealthMonitoring() {
    this.health.start(() => this.nodes.getAll());
    this.health.onFailure((nodeId) => {
      this.failedNodes.add(nodeId);
      this.nodes.updateStatus(nodeId, 'failed');
      this.loggers.error(`[Repeater] Node failure detected: ${nodeId}`);
    });
    this.health.onRecovery((nodeId) => {
      this.failedNodes.delete(nodeId);
      this.nodes.updateStatus(nodeId, 'online');
      this.loggers.info(`[Repeater] Node recovered: ${nodeId}`);
    });
    this.loggers.info('[Repeater] Health monitoring started');
  }

  stopHealthMonitoring() {
    this.health.stop();
    this.loggers.info('[Repeater] Health monitoring stopped');
  }

  failoverNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    this.failedNodes.add(nodeId);
    this.nodes.updateStatus(nodeId, 'failed');
    this.loggers.warn(`[Repeater] Manual failover for node: ${nodeId}`);
    return structuredClone(node);
  }

  recoverNode(nodeId) {
    const node = this.nodes.get(nodeId);
    if (!node) return null;
    this.failedNodes.delete(nodeId);
    this.nodes.updateStatus(nodeId, 'online');
    this.health.recordHeartbeat(nodeId);
    this.loggers.info(`[Repeater] Node manually recovered: ${nodeId}`);
    return structuredClone(node);
  }
}

function createRepeaterService(options = {}) {
  const service = new RepeaterService(options);
  return service;
}

module.exports = { RepeaterService, createRepeaterService, DEFAULT_CACHE_TTL_MS, DEFAULT_HEARTBEAT_INTERVAL_MS, DEFAULT_HEARTBEAT_TIMEOUT_MS, DEFAULT_MAX_HOPS, DEFAULT_MAX_CACHE_ITEMS, DEFAULT_NODE_TTL_MS };

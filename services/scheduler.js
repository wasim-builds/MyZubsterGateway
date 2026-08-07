/**
 * Robot Scheduler Service - Bounty #786
 *
 * Gestisce la schedulazione dei job per i robot, la coda di lavoro,
 * il monitoraggio dello stato dei robot, le notifiche in tempo reale
 * e l'esportazione dati per il dashboard di controllo.
 *
 * Tutti i dati sono mantenuti in memoria tramite Map:
 *   - jobs: Map<jobId, Job>
 *   - robots: Map<robotId, RobotState>
 *   - notifications: Map<notificationId, Notification>
 */

const { notifyRobot, notifyUser } = require('../notifications');

const JOB_STATUS = {
  PENDING: 'pending',
  QUEUED: 'queued',
  ASSIGNED: 'assigned',
  WORKING: 'working',
  DELIVERING: 'delivering',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  FAILED: 'failed'
};

const ROBOT_STATUS = {
  IDLE: 'idle',
  WORKING: 'working',
  DELIVERING: 'delivering',
  DISPUTE: 'dispute'
};

const NOTIFICATION_TYPE = {
  JOB_ASSIGNED: 'job_assigned',
  JOB_COMPLETED: 'job_completed',
  JOB_CANCELLED: 'job_cancelled',
  ROBOT_STATUS_CHANGE: 'robot_status_change',
  QUEUE_UPDATE: 'queue_update',
  SYSTEM_ALERT: 'system_alert'
};

const jobs = new Map();
const robots = new Map();
const notifications = new Map();
const jobQueue = [];
const listeners = new Set();

let schedulerInterval = null;
let jobCounter = 0;
let robotCounter = 0;
let notificationCounter = 0;

function generateId(prefix, counter) {
  return `${prefix}-${Date.now().toString(36)}-${counter.toString(36)}`;
}

function emit(event, data) {
  for (const listener of listeners) {
    try {
      listener(event, data);
    } catch (err) {
      console.error('[Scheduler] listener error:', err.message);
    }
  }
}

function addNotification(type, recipientId, message, metadata = {}) {
  const id = generateId('notif', ++notificationCounter);
  const notification = {
    id,
    type,
    recipientId,
    message,
    metadata,
    timestamp: Date.now(),
    read: false
  };
  notifications.set(id, notification);
  emit('notification', notification);
  return notification;
}

function scheduleJob(job) {
  if (schedulerInterval) return;

  schedulerInterval = setInterval(() => {
    processQueue();
  }, 1000);
}

function clearSchedule() {
  if (schedulerInterval) {
    clearInterval(schedulerInterval);
    schedulerInterval = null;
  }
}

function processQueue() {
  const availableRobots = Array.from(robots.values()).filter(
    r => r.status === ROBOT_STATUS.IDLE
  );

  while (jobQueue.length > 0 && availableRobots.length > 0) {
    const job = jobQueue.shift();
    const robot = availableRobots.shift();

    if (job.status !== JOB_STATUS.QUEUED) continue;
    if (!robot || robot.status !== ROBOT_STATUS.IDLE) continue;

    assignJobToRobot(job, robot);
  }
}

function assignJobToRobot(job, robot) {
  job.robotId = robot.robotId;
  job.status = JOB_STATUS.ASSIGNED;
  job.assignedAt = Date.now();

  robot.status = ROBOT_STATUS.WORKING;
  robot.currentJobId = job.id;
  robot.lastAssignedAt = Date.now();

  addNotification(
    NOTIFICATION_TYPE.JOB_ASSIGNED,
    robot.robotId,
    `Job ${job.id} assegnato a robot ${robot.name}. Priorita: ${job.priority}`,
    { jobId: job.id, robotId: robot.robotId, priority: job.priority }
  );

  addNotification(
    NOTIFICATION_TYPE.QUEUE_UPDATE,
    'system',
    `Job ${job.id} rimosso dalla coda. Robot ${robot.name} in lavorazione.`,
    { jobId: job.id, robotId: robot.robotId, queueLength: jobQueue.length }
  );

  emit('job:assigned', { job, robot });

  setTimeout(() => {
    if (job.status === JOB_STATUS.ASSIGNED) {
      completeJob(job.id, robot.robotId);
    }
  }, job.duration || 5000);
}

function completeJob(jobId, robotId) {
  const job = jobs.get(jobId);
  const robot = robots.get(robotId);
  if (!job || !robot) return;

  job.status = JOB_STATUS.DELIVERING;
  job.completedAt = Date.now();

  robot.status = ROBOT_STATUS.DELIVERING;
  robot.lastCompletedAt = Date.now();
  robot.jobsCompleted = (robot.jobsCompleted || 0) + 1;
  robot.reputation = (robot.reputation || 0) + 1;

  addNotification(
    NOTIFICATION_TYPE.JOB_COMPLETED,
    robotId,
    `Job ${jobId} completato da ${robot.name}`,
    { jobId, robotId, robotName: robot.name }
  );

  emit('job:completed', { job, robot });

  setTimeout(() => {
    deliverJob(jobId, robotId);
  }, 3000);
}

function deliverJob(jobId, robotId) {
  const job = jobs.get(jobId);
  const robot = robots.get(robotId);
  if (!job || !robot) return;

  job.status = JOB_STATUS.COMPLETED;
  job.deliveredAt = Date.now();

  robot.status = ROBOT_STATUS.IDLE;
  robot.currentJobId = null;
  robot.totalEarned = (robot.totalEarned || 0) + (job.reward || 0);
  robot.lastDeliveredAt = Date.now();

  addNotification(
    NOTIFICATION_TYPE.JOB_COMPLETED,
    robotId,
    `Job ${jobId} consegnato da ${robot.name}`,
    { jobId, robotId, robotName: robot.name, reward: job.reward }
  );

  emit('job:delivered', { job, robot });
  processQueue();
}

function registerRobot(robotData) {
  const id = robotData.robotId || generateId('robot', ++robotCounter);
  if (robots.has(id)) return robots.get(id);

  const robot = {
    robotId: id,
    name: robotData.name || `Robot ${id}`,
    status: ROBOT_STATUS.IDLE,
    currentJobId: null,
    reputation: 0,
    jobsCompleted: 0,
    totalEarned: 0,
    capabilities: robotData.capabilities || [],
    maxConcurrentJobs: robotData.maxConcurrentJobs || 1,
    createdAt: Date.now(),
    lastAssignedAt: null,
    lastCompletedAt: null,
    lastDeliveredAt: null,
    history: []
  };

  robots.set(id, robot);
  scheduleJob();

  addNotification(
    NOTIFICATION_TYPE.SYSTEM_ALERT,
    'system',
    `Robot ${robot.name} registrato nel sistema`,
    { robotId: id, robotName: robot.name }
  );

  emit('robot:registered', robot);
  return robot;
}

function unregisterRobot(robotId) {
  const robot = robots.get(robotId);
  if (!robot) return null;

  if (robot.status === ROBOT_STATUS.WORKING || robot.status === ROBOT_STATUS.DELIVERING) {
    const activeJob = jobs.get(robot.currentJobId);
    if (activeJob) {
      activeJob.status = JOB_STATUS.PENDING;
      activeJob.robotId = null;
      jobQueue.push(activeJob);
      addNotification(
        NOTIFICATION_TYPE.QUEUE_UPDATE,
        'system',
        `Job ${activeJob.id} rimesso in coda dopo rimozione robot ${robot.name}`,
        { jobId: activeJob.id, robotId }
      );
    }
  }

  robots.delete(robotId);
  addNotification(
    NOTIFICATION_TYPE.SYSTEM_ALERT,
    'system',
    `Robot ${robot.name} rimosso dal sistema`,
    { robotId, robotName: robot.name }
  );

  emit('robot:unregistered', { robotId });
  return robot;
}

function addJob(jobData) {
  const id = jobData.id || generateId('job', ++jobCounter);
  if (jobs.has(id)) return jobs.get(id);

  const job = {
    id,
    type: jobData.type || 'generic',
    priority: jobData.priority || 5,
    status: JOB_STATUS.PENDING,
    payload: jobData.payload || {},
    reward: jobData.reward || 0,
    duration: jobData.duration || 5000,
    clientId: jobData.clientId || null,
    createdAt: Date.now(),
    assignedAt: null,
    completedAt: null,
    deliveredAt: null,
    robotId: null
  };

  jobs.set(id, job);

  if (job.priority <= 3) {
    jobQueue.unshift(job);
  } else {
    jobQueue.push(job);
  }

  job.status = JOB_STATUS.QUEUED;

  addNotification(
    NOTIFICATION_TYPE.QUEUE_UPDATE,
    'system',
    `Job ${id} aggiunto alla coda con priorita ${job.priority}`,
    { jobId: id, priority: job.priority, queueLength: jobQueue.length }
  );

  emit('job:added', job);
  scheduleJob();
  return job;
}

function cancelJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;

  const queueIndex = jobQueue.findIndex(j => j.id === jobId);
  if (queueIndex !== -1) {
    jobQueue.splice(queueIndex, 1);
  }

  job.status = JOB_STATUS.CANCELLED;
  job.cancelledAt = Date.now();

  if (job.robotId) {
    const robot = robots.get(job.robotId);
    if (robot && robot.currentJobId === jobId) {
      robot.status = ROBOT_STATUS.IDLE;
      robot.currentJobId = null;
      emit('robot:status_changed', robot);
    }
  }

  addNotification(
    NOTIFICATION_TYPE.JOB_CANCELLED,
    'system',
    `Job ${jobId} cancellato`,
    { jobId, reason: 'manual_cancel' }
  );

  emit('job:cancelled', job);
  return job;
}

function getJob(jobId) {
  const job = jobs.get(jobId);
  if (!job) return null;
  return {
    id: job.id,
    type: job.type,
    priority: job.priority,
    status: job.status,
    payload: job.payload,
    reward: job.reward,
    duration: job.duration,
    clientId: job.clientId,
    createdAt: job.createdAt,
    assignedAt: job.assignedAt,
    completedAt: job.completedAt,
    deliveredAt: job.deliveredAt,
    robotId: job.robotId
  };
}

function getRobot(robotId) {
  const robot = robots.get(robotId);
  if (!robot) return null;
  return {
    robotId: robot.robotId,
    name: robot.name,
    status: robot.status,
    currentJobId: robot.currentJobId,
    reputation: robot.reputation,
    jobsCompleted: robot.jobsCompleted,
    totalEarned: robot.totalEarned,
    capabilities: robot.capabilities,
    maxConcurrentJobs: robot.maxConcurrentJobs,
    createdAt: robot.createdAt,
    lastAssignedAt: robot.lastAssignedAt,
    lastCompletedAt: robot.lastCompletedAt,
    lastDeliveredAt: robot.lastDeliveredAt,
    history: robot.history.slice(-20)
  };
}

function getAllJobs() {
  return Array.from(jobs.values()).map(j => ({
    id: j.id,
    type: j.type,
    priority: j.priority,
    status: j.status,
    reward: j.reward,
    duration: j.duration,
    clientId: j.clientId,
    createdAt: j.createdAt,
    assignedAt: j.assignedAt,
    completedAt: j.completedAt,
    deliveredAt: j.deliveredAt,
    robotId: j.robotId
  }));
}

function getAllRobots() {
  return Array.from(robots.values()).map(r => ({
    robotId: r.robotId,
    name: r.name,
    status: r.status,
    currentJobId: r.currentJobId,
    reputation: r.reputation,
    jobsCompleted: r.jobsCompleted,
    totalEarned: r.totalEarned,
    capabilities: r.capabilities,
    maxConcurrentJobs: r.maxConcurrentJobs,
    createdAt: r.createdAt,
    lastAssignedAt: r.lastAssignedAt,
    lastCompletedAt: r.lastCompletedAt,
    lastDeliveredAt: r.lastDeliveredAt,
    history: r.history.slice(-20)
  }));
}

function getQueue() {
  return jobQueue.map(j => ({
    id: j.id,
    type: j.type,
    priority: j.priority,
    status: j.status,
    reward: j.reward,
    duration: j.duration,
    clientId: j.clientId,
    createdAt: j.createdAt
  }));
}

function getNotifications(recipientId = null, unreadOnly = false) {
  let result = Array.from(notifications.values());
  if (recipientId) {
    result = result.filter(n => n.recipientId === recipientId || n.recipientId === 'system');
  }
  if (unreadOnly) {
    result = result.filter(n => !n.read);
  }
  return result.sort((a, b) => b.timestamp - a.timestamp);
}

function markNotificationRead(notificationId) {
  const notification = notifications.get(notificationId);
  if (notification) {
    notification.read = true;
    return notification;
  }
  return null;
}

function getDashboardData() {
  const allJobs = getAllJobs();
  const allRobotsList = getAllRobots();
  const queue = getQueue();

  const byStatus = {};
  const byType = {};
  let totalReward = 0;
  let totalEarned = 0;

  for (const job of allJobs) {
    byStatus[job.status] = (byStatus[job.status] || 0) + 1;
    byType[job.type] = (byType[job.type] || 0) + 1;
    totalReward += job.reward || 0;
  }

  for (const robot of allRobotsList) {
    totalEarned += robot.totalEarned || 0;
  }

  const robotByStatus = {};
  for (const robot of allRobotsList) {
    robotByStatus[robot.status] = (robotByStatus[robot.status] || 0) + 1;
  }

  const topRobots = allRobotsList
    .slice()
    .sort((a, b) => b.jobsCompleted - a.jobsCompleted || b.reputation - a.reputation)
    .slice(0, 5)
    .map(r => ({
      robotId: r.robotId,
      name: r.name,
      status: r.status,
      jobsCompleted: r.jobsCompleted,
      reputation: r.reputation,
      totalEarned: r.totalEarned
    }));

  const recentNotifications = getNotifications(null, false).slice(0, 20);

  return {
    timestamp: Date.now(),
    jobs: {
      total: allJobs.length,
      byStatus,
      byType,
      totalReward,
      queueLength: queue.length
    },
    robots: {
      total: allRobotsList.length,
      byStatus: robotByStatus,
      topRobots,
      totalEarned
    },
    queue: queue.slice(0, 20),
    recentNotifications
  };
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getStats() {
  return {
    jobs: jobs.size,
    robots: robots.size,
    notifications: notifications.size,
    queueLength: jobQueue.length,
    listeners: listeners.size,
    schedulerRunning: schedulerInterval !== null
  };
}

function clear() {
  jobs.clear();
  robots.clear();
  notifications.clear();
  jobQueue.length = 0;
  listeners.clear();
  clearSchedule();
  jobCounter = 0;
  robotCounter = 0;
  notificationCounter = 0;
}

module.exports = {
  JOB_STATUS,
  ROBOT_STATUS,
  NOTIFICATION_TYPE,
  registerRobot,
  unregisterRobot,
  addJob,
  cancelJob,
  getJob,
  getRobot,
  getAllJobs,
  getAllRobots,
  getQueue,
  getNotifications,
  markNotificationRead,
  getDashboardData,
  subscribe,
  getStats,
  clear
};

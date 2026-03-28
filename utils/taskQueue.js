// Task Queue - lưu task trong bộ nhớ (reset khi server restart)
const tasks = new Map();
let nextId = 1;

function create(type, params, targetAgent = null) {
  const task = {
    id: nextId++,
    type,
    params,
    targetAgent,         // null = bất kỳ agent nào cũng nhận được
    status: 'pending',   // pending | running | done | failed
    logs: [],
    agentInfo: null,
    createdAt: Date.now(),
    startedAt: null,
    doneAt: null,
    error: null,
  };
  tasks.set(task.id, task);
  console.log(`📋 Task #${task.id} [${type}] đã được tạo${targetAgent ? ` → ${targetAgent}` : ''}`);
  return task;
}

function claim(agentInfo) {
  for (const [, t] of tasks) {
    if (t.status === 'pending' && (!t.targetAgent || t.targetAgent === agentInfo)) {
      t.status = 'running';
      t.agentInfo = agentInfo || 'unknown';
      t.startedAt = Date.now();
      console.log(`🤖 Task #${t.id} được nhận bởi agent: ${agentInfo}`);
      return t;
    }
  }
  return null;
}

function addLog(id, msg) {
  const t = tasks.get(id);
  if (t) {
    t.logs.push({ time: Date.now(), msg });
    console.log(`[Task #${id}] ${msg}`);
  }
}

function finish(id, status, error) {
  const t = tasks.get(id);
  if (t) {
    t.status = status; // 'done' hoặc 'failed'
    t.doneAt = Date.now();
    if (error) t.error = error;
    console.log(`${status === 'done' ? '✅' : '❌'} Task #${id} ${status}${error ? ': ' + error : ''}`);
  }
}

function get(id) {
  return tasks.get(id) || null;
}

function getAll() {
  return [...tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
}

module.exports = { create, claim, addLog, finish, get, getAll };

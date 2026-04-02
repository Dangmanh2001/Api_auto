// Task Queue - lưu task trong bộ nhớ (reset khi server restart)
const EventEmitter = require("events");

class TaskQueue extends EventEmitter {
  constructor() {
    super();
    this.tasks = new Map();
    this.nextId = 1;
  }

  create(type, params, targetAgent = null) {
    const task = {
      id: this.nextId++,
      type,
      params,
      targetAgent,
      status: "pending",
      logs: [],
      agentInfo: null,
      createdAt: Date.now(),
      startedAt: null,
      doneAt: null,
      error: null,
    };
    this.tasks.set(task.id, task);
    console.log(
      `📋 Task #${task.id} [${type}] đã được tạo${targetAgent ? ` → ${targetAgent}` : ""}`,
    );

    // Phát sự kiện để SSE biết có task mới
    this.emit("created", task);
    this.emit("updated");
    return task;
  }

  claim(agentInfo) {
    for (const [, t] of this.tasks) {
      if (
        t.status === "pending" &&
        (!t.targetAgent || t.targetAgent === agentInfo)
      ) {
        t.status = "running";
        t.agentInfo = agentInfo || "unknown";
        t.startedAt = Date.now();
        console.log(`🤖 Task #${t.id} được nhận bởi agent: ${agentInfo}`);
        this.emit("updated");
        return t;
      }
    }
    return null;
  }

  addLog(id, msg) {
    const t = this.tasks.get(id);
    if (t) {
      t.logs.push({ time: Date.now(), msg });
      console.log(`[Task #${id}] ${msg}`);
      this.emit("log", { taskId: id, msg });
      this.emit("updated");
    }
  }

  finish(id, status, error) {
    const t = this.tasks.get(id);
    if (t) {
      t.status = status;
      t.doneAt = Date.now();
      if (error) t.error = error;
      console.log(
        `${status === "done" ? "✅" : "❌"} Task #${id} ${status}${error ? ": " + error : ""}`,
      );
      this.emit("updated");
    }
  }

  get(id) {
    return this.tasks.get(id) || null;
  }

  getAll() {
    return [...this.tasks.values()].sort((a, b) => b.createdAt - a.createdAt);
  }
}

module.exports = new TaskQueue();

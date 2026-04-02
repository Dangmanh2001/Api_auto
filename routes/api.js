var express = require("express");
var router = express.Router();
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { spawn } = require("child_process");
const TextToVideoControllers = require("../controllers/TextToVideo.controllers");
const ImageToVideoController = require("../controllers/ImageToVideo.controller");
const IngredientsToVideo = require("../controllers/IngredientsToVideo");
const taskQueue = require("../utils/taskQueue");

// ==================== AGENT PROCESS MANAGER ====================
let agentProcess = null;
let agentPid = null;
let agentLogs = [];

// Quản lý các kết nối SSE của Agent
const agentTaskSseClients = new Map(); // agentId -> res
const logSseClients = new Set(); // Clients watching the logs UI

function tryDispatchTask(agentId) {
  const res = agentTaskSseClients.get(agentId);
  if (!res) return false;

  const task = taskQueue.claim(agentId);
  if (task) {
    res.write(`event: task\ndata: ${JSON.stringify({ task })}\n\n`);
    return true;
  }
  return false;
}

// Lắng nghe sự kiện từ taskQueue
taskQueue.on("created", (task) => {
  if (task.targetAgent) {
    tryDispatchTask(task.targetAgent);
  } else {
    // Broadcast cho agent rảnh bất kỳ
    for (const agentId of agentTaskSseClients.keys()) {
      if (tryDispatchTask(agentId)) break;
    }
  }
});

// Lắng nghe log từ taskQueue để broadcast cho UI qua SSE
taskQueue.on("log", ({ taskId, msg }) => {
  appendAgentLog(`[Task #${taskId}] ${msg}`);
});

function appendAgentLog(msg) {
  agentLogs.push(msg);
  if (agentLogs.length > 100) agentLogs.shift();

  // Broadcast to all UI clients watching logs
  const data = JSON.stringify({ msg });
  logSseClients.forEach((client) =>
    client.write(`event: log\ndata: ${data}\n\n`),
  );
}

function findChrome() {
  const candidates = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google\\Chrome\\Application\\chrome.exe",
    ),
  ];
  return candidates.find((p) => fs.existsSync(p)) || null;
}

function startAgent(profilePath) {
  if (agentProcess) return { ok: false, msg: "Agent đang chạy" };
  if (!profilePath) return { ok: false, msg: "Chưa nhập đường dẫn profile" };

  const chromePath = findChrome();
  if (!chromePath) return { ok: false, msg: "Không tìm thấy Chrome trên máy" };

  // Tách userDataDir và profileDir từ đường dẫn
  const normalized = profilePath.trim().replace(/\//g, "\\");
  const lastSlash = normalized.lastIndexOf("\\");
  if (lastSlash === -1) return { ok: false, msg: "Đường dẫn không hợp lệ" };
  const userDataDir = normalized.substring(0, lastSlash);
  const profileDir = normalized.substring(lastSlash + 1);

  agentLogs = [];
  const extensionPath = path.join(__dirname, "..", "flow-extension");
  appendAgentLog(`👤 Profile: ${profileDir}`);
  appendAgentLog(`🚀 Đang mở Chrome...`);

  agentProcess = spawn(chromePath, [
    `--load-extension=${extensionPath}`,
    `--user-data-dir=${userDataDir}`,
    `--profile-directory=${profileDir}`,
    "--no-first-run",
    "--no-default-browser-check",
    "http://localhost:3000",
  ]);

  agentPid = agentProcess.pid;
  appendAgentLog(`✅ Chrome mở với profile: ${profileDir}`);
  appendAgentLog(`ℹ️ Khi dừng: nhấn Stop rồi tự đóng cửa sổ Chrome`);

  agentProcess.on("exit", () => {
    agentProcess = null;
    agentPid = null;
    appendAgentLog("🔴 Chrome đã đóng");
  });

  return { ok: true, msg: "Chrome đã khởi động với extension" };
}

function stopAgent() {
  if (!agentPid) return { ok: false, msg: "Agent chưa chạy" };
  // Chỉ kill đúng PID của Chrome đã spawn, không ảnh hưởng Chrome khác
  spawn("taskkill", ["/PID", String(agentPid), "/F", "/T"]);
  agentProcess = null;
  agentPid = null;
  return { ok: true, msg: "Agent đã dừng" };
}

// Cấu hình storage
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    // const filePath = path.join("uploads", file.originalname);

    // if (fs.existsSync(filePath)) {
    //   return cb(new Error("File đã tồn tại"));
    // }

    // Tên file: timestamp + tên gốc
    cb(null, file.originalname);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (req, file, cb) => {
    // Chỉ cho upload file ảnh
    const allowedMimes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

    if (!allowedMimes.includes(file.mimetype)) {
      return cb(new Error(`File type ${file.mimetype} không được phép`));
    }

    const filePath = path.join(__dirname, "..", "uploads", file.originalname);

    // nếu file đã tồn tại thì bỏ qua
    if (fs.existsSync(filePath)) {
      console.log("File đã tồn tại:", file.originalname);
      return cb(null, true);
    }

    cb(null, true);
  },
});

/* Tạo video bằng text */
router.get("/", TextToVideoControllers.TextToVideoveo3Api);
// Thêm middleware upload.array() để xử lý nhiều file với field name là "images"
router.post(
  "/",
  upload.array("images"),
  TextToVideoControllers.TextToVideoveo3ApiPost,
);
/* Tạo video bằng Ảnh */
router.get("/imageToVideo", ImageToVideoController.ImageToVideo);

router.post(
  "/imageToVideo",
  upload.any(),
  ImageToVideoController.ImageToVideoPost,
);
/* Tạo video thành phần */
router.get("/IngredientsToVideo", IngredientsToVideo.IngredientsToVideo);
router.post(
  "/IngredientsToVideo",
  upload.any(),
  IngredientsToVideo.IngredientsToVideoPost,
);
/* Gọi api gemini để phân tích video */
router.get("/gemini", TextToVideoControllers.gemini);
router.post("/gemini", TextToVideoControllers.postGemini);

// ==================== AGENT API ====================
// SSE Endpoint cho Agent để nhận Task thời gian thực
router.get("/agent/stream", (req, res) => {
  const agentId = req.query.agent;
  if (!agentId) return res.status(400).send("Missing agent ID");

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  agentTaskSseClients.set(agentId, res);
  console.log(`📡 Agent ${agentId} đã kết nối SSE`);

  // Thử gửi task ngay nếu đang có sẵn trong hàng đợi
  tryDispatchTask(agentId);

  req.on("close", () => {
    agentTaskSseClients.delete(agentId);
    console.log(`🔌 Agent ${agentId} đã ngắt kết nối SSE`);
  });
});

// SSE Endpoint cho Dashboard UI để nhận Log thời gian thực
router.get("/agent/logs/stream", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  // Send initial logs
  res.write(`event: init\ndata: ${JSON.stringify({ logs: agentLogs })}\n\n`);

  logSseClients.add(res);

  req.on("close", () => {
    logSseClients.delete(res);
  });
});

// Agent gửi log về server
router.post("/agent/log/:id", (req, res) => {
  taskQueue.addLog(parseInt(req.params.id), req.body.msg || "");
  res.json({ ok: true });
});

// Agent báo hoàn thành / thất bại
router.post("/agent/finish/:id", (req, res) => {
  const { status, error } = req.body;
  taskQueue.finish(parseInt(req.params.id), status || "done", error);
  res.json({ ok: true });
});

// UI xem danh sách tất cả task
router.get("/tasks", (_req, res) => {
  res.json(taskQueue.getAll());
});

// UI xem chi tiết 1 task
router.get("/task/:id", (req, res) => {
  const task = taskQueue.get(parseInt(req.params.id));
  if (!task) return res.status(404).json({ error: "Task not found" });
  res.json(task);
});

// Khởi động agent
router.post("/agent/start", (req, res) =>
  res.json(startAgent(req.body.profilePath)),
);

// Dừng agent
router.post("/agent/stop", (_req, res) => res.json(stopAgent()));

// Trạng thái agent
router.get("/agent/running", (_req, res) => {
  res.json({ running: agentProcess !== null });
});

// Lấy logs agent
router.get("/agent/logs", (_req, res) => {
  res.json({ logs: agentLogs });
});

module.exports = router;

const taskQueue = require("../utils/taskQueue");

const imageModels = ["🍌 Nano Banana Pro", "🍌 Nano Banana 2", "Imagen 4"];

const DEFAULT_PROMPT =
  "Continue this same landscape as a time-lapse sequence, keep the same camera angle and location, advance the time naturally, cinematic realistic detail";

function normalizeImageCount(value) {
  const count = Number.parseInt(value, 10);
  if (!Number.isInteger(count) || count < 1) return 1;
  return count;
}

function buildPromptList(promptInput, imageCount) {
  // Tách các dòng, loại bỏ khoảng trắng dư thừa và dòng trống
  const lines = promptInput
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const isSinglePrompt = lines.length === 1;
  const isEmpty = lines.length === 0;

  return Array.from(
    { length: Math.max(0, imageCount - 1) },
    (_unused, index) => {
      // Xác định prompt cho bước hiện tại
      const currentLine = isEmpty
        ? DEFAULT_PROMPT
        : isSinglePrompt
          ? lines[0]
          : lines[index] || DEFAULT_PROMPT;

      return [
        currentLine,
        "Use all provided reference images as continuity. Keep the same subject, location and composition. Advance the scene one natural step forward.",
      ]
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
    },
  );
}

module.exports = {
  getPage: (_req, res) => {
    res.render("TimeslapImage", {
      imageModels,
      error: null,
    });
  },

  post: async (req, res) => {
    try {
      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;
      const renderCount = "x1";
      const agentId = req.agentId || req.body.agentId || null;

      const promptInput = String(req.body.prompt || "").trim();
      const imageCount = normalizeImageCount(req.body.imageCount);
      const initialImageName = req.file ? req.file.filename : "";

      if (!initialImageName) {
        return res.send(
          `<script>alert("Vui lòng chọn ảnh 1 để bắt đầu timeslap."); window.history.back();</script>`,
        );
      }

      const promptList = buildPromptList(promptInput, imageCount);

      taskQueue.create(
        "timeslap-image",
        {
          aspectRatio,
          modelType,
          renderCount,
          prompt: promptInput || DEFAULT_PROMPT,
          imageCount,
          initialImageName,
          promptList,
        },
        agentId,
      );

      return res.redirect("/api/timeslapImage");
    } catch (error) {
      console.error("Timeslap image task error:", error.message);
      return res.send(
        `<script>alert("Lỗi hệ thống: ${error.message}"); window.history.back();</script>`,
      );
    }
  },
};

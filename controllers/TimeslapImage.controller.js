const taskQueue = require("../utils/taskQueue");

const MAX_IMAGES = 10;

function normalizeImageCount(value) {
  const count = Number.parseInt(value, 10);
  if (!Number.isInteger(count) || count < 1) return 1;
  return Math.min(count, MAX_IMAGES);
}

function buildPromptList(prompt, imageCount) {
  return Array.from({ length: Math.max(0, imageCount - 1) }, (_unused, index) =>
    [
      `Create timeslap image ${index + 2}/${imageCount}.`,
      prompt,
      "Use all provided reference images as continuity. Keep the same subject, location and composition. Advance the scene one natural step forward.",
    ]
      .join(" ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

module.exports = {
  getPage: (_req, res) => {
    res.render("TimeslapImage", {
      maxImages: MAX_IMAGES,
      error: null,
    });
  },

  post: async (req, res) => {
    try {
      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;
      const renderCount = "x1";
      const agentId = req.agentId || req.body.agentId || null;

      const prompt = String(req.body.prompt || "").trim();
      const imageCount = normalizeImageCount(req.body.imageCount);
      const initialImageName = req.file ? req.file.filename : "";

      if (!prompt) {
        return res.send(
          `<script>alert("Vui lòng nhập câu lệnh/prompt cho case ảnh."); window.history.back();</script>`,
        );
      }

      if (!initialImageName) {
        return res.send(
          `<script>alert("Vui lòng chọn ảnh 1 để bắt đầu timeslap."); window.history.back();</script>`,
        );
      }

      const promptList = buildPromptList(prompt, imageCount);

      taskQueue.create(
        "timeslap-image",
        {
          aspectRatio,
          modelType,
          renderCount,
          prompt,
          imageCount,
          maxImages: MAX_IMAGES,
          initialImageName,
          promptList,
        },
        agentId,
      );

      return res.redirect("/api/timeslapImage");
    } catch (error) {
      console.error("Timeslap image task error:", error.message);
      return res.send(`<script>alert("Lỗi hệ thống: ${error.message}"); window.history.back();</script>`);
    }
  },
};

const taskQueue = require("../utils/taskQueue");

module.exports = {
  getPage: (req, res) => res.render("TextToImage", { error: req.query.error || null }),

  post: async (req, res) => {
    try {
      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;
      const renderCount = req.body.renderCount || "x1";
      const agentId = req.agentId || req.body.agentId || null;

      const DEFAULT_PROMPT =
        "A cinematic video, smooth camera movement, high quality, detailed, 4K resolution, realistic lighting, professional composition";
      const rawPrompts = req.body.prompts;
      const promptList = rawPrompts
        ? rawPrompts
            .split("\n")
            .map((p) => p.trim() || DEFAULT_PROMPT)
            .filter((p) => p !== "")
        : [DEFAULT_PROMPT];

      taskQueue.create(
        "text-to-image",
        { aspectRatio, modelType, renderCount, promptList },
        agentId,
      );
      return res.redirect("/api/textToImage");
    } catch (error) {
      console.error("❌ Lỗi tạo task:", error.message);
      return res.send(`<script>alert("Lỗi hệ thống: ${error.message}"); window.history.back();</script>`);
    }
  },
};

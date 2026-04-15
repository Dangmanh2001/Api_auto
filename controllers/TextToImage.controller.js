const taskQueue = require("../utils/taskQueue");

module.exports = {
  getPage: (_req, res) => res.render("TextToImage"),

  post: async (req, res) => {
    try {
      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;
      const agentId = req.body.agentId || null;
      if (!agentId) return res.redirect("/api/textToImage");

      const rawPrompts = req.body.prompts;
      const promptList = rawPrompts
        ? rawPrompts
            .split("\n")
            .map((p) => p.trim())
            .filter((p) => p !== "")
        : [];

      taskQueue.create(
        "text-to-image",
        { aspectRatio, modelType, promptList },
        agentId,
      );
      return res.redirect("/api/textToImage");
    } catch (error) {
      console.error("❌ Lỗi tạo task:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  },
};

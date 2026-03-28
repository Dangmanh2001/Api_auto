const path = require("path");
const taskQueue = require("../utils/taskQueue");

module.exports = {
  ImageToVideo: async (req, res) => {
    res.render("ImageToVideo.ejs");
  },

  ImageToVideoPost: async (req, res) => {
    try {
      const agentId = req.body.agentId || null;
      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;

      // Map files theo index: start_images[0], end_images[0], start_images[1], ...
      const fileMap = {};
      (req.files || []).forEach((f) => { fileMap[f.fieldname] = f; });

      // prompts có thể là object {0: "...", 1: "..."} hoặc array
      const promptsRaw = req.body.prompts || {};

      const tasks = [];
      let i = 0;
      while (true) {
        const startFile = fileMap[`start_images[${i}]`];
        const prompt = Array.isArray(promptsRaw) ? promptsRaw[i] : promptsRaw[String(i)];
        if (!startFile || !prompt) break;
        const endFile = fileMap[`end_images[${i}]`];
        tasks.push({
          id: i + 1,
          prompt,
          startImage: startFile.path,
          endImage: endFile ? endFile.path : null,
        });
        i++;
      }

      if (tasks.length === 0) {
        return res.send(`<script>alert("Không có task hợp lệ!"); window.history.back();</script>`);
      }

      const taskPayload = tasks.map((t) => ({
        prompt: t.prompt,
        startImageName: path.basename(t.startImage),
        endImageName: t.endImage ? path.basename(t.endImage) : null,
      }));

      taskQueue.create("image-to-video", { aspectRatio, modelType, tasks: taskPayload }, agentId);
      return res.redirect("/api/imageToVideo");
    } catch (error) {
      console.error("❌ Lỗi tạo task:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  },
};

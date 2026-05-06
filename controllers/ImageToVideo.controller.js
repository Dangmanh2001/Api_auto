const path = require("path");
const taskQueue = require("../utils/taskQueue");

const DEFAULT_PROMPT =
  "A cinematic video, smooth camera movement, high quality, detailed, 4K resolution, realistic lighting, professional composition";

module.exports = {
  ImageToVideo: async (req, res) => {
    res.render("ImageToVideo.ejs", { defaultPrompt: DEFAULT_PROMPT });
  },

  ImageToVideoPost: async (req, res) => {
    try {
      const agentId = req.agentId || req.body.agentId || null;

      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;
      const renderCount = req.body.renderCount || "x1";
      const defaultPrompt = (req.body.defaultPrompt || "").trim() || DEFAULT_PROMPT;

      // Map files theo index: start_images[0], end_images[0], start_images[1], ...
      const fileMap = {};
      (req.files || []).forEach((f) => {
        fileMap[f.fieldname] = f;
      });

      // prompts có thể là object {0: "...", 1: "..."} hoặc array
      const promptsRaw = req.body.prompts || {};

      const tasks = [];
      let i = 0;
      while (true) {
        const startFile = fileMap[`start_images[${i}]`];
        if (!startFile) break;
        const promptRaw = Array.isArray(promptsRaw)
          ? promptsRaw[i]
          : promptsRaw[String(i)];
        const prompt = (promptRaw || "").trim() || defaultPrompt;
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
        return res.send(
          `<script>alert("Không có task hợp lệ!"); window.history.back();</script>`,
        );
      }

      const taskPayload = tasks.map((t) => ({
        prompt: t.prompt,
        startImageName: path.basename(t.startImage),
        endImageName: t.endImage ? path.basename(t.endImage) : null,
      }));

      taskQueue.create(
        "image-to-video",
        { aspectRatio, modelType, renderCount, defaultPrompt, tasks: taskPayload },
        agentId,
      );
      return res.redirect("/api/imageToVideo");
    } catch (error) {
      console.error("❌ Lỗi tạo task:", error.message);
      return res.send(`<script>alert("Lỗi: ${error.message}"); window.history.back();</script>`);
    }
  },
};

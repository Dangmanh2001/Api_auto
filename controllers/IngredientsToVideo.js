const taskQueue = require("../utils/taskQueue");

const DEFAULT_PROMPT =
  "A cinematic video, smooth camera movement, high quality, detailed, 4K resolution, realistic lighting, professional composition";

module.exports = {
  IngredientsToVideo: async (req, res) => {
    res.render("IngredientsToVideo.ejs");
  },

  IngredientsToVideoPost: async (req, res) => {
    try {
      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;
      const renderCount = req.body.renderCount || "x1";
      const agentId = req.agentId || req.body.agentId || null;

      const prompts = req.body.prompts;
      const promptList = Array.isArray(prompts) ? prompts : [prompts];

      const allFiles = req.files || [];
      const ingredients = promptList.map((prompt, index) => {
        const fieldName = `images_${index + 1}[]`;
        const imageNames = allFiles
          .filter((file) => file.fieldname === fieldName)
          .map((file) => file.originalname);
        return { prompt: (prompt || "").trim() || DEFAULT_PROMPT, imageNames };
      });

      taskQueue.create(
        "ingredients-to-video",
        { aspectRatio, modelType, renderCount, ingredients },
        agentId,
      );
      return res.redirect("/api/IngredientsToVideo");
    } catch (error) {
      console.error(error);
      return res.send(`<script>alert("Lỗi xử lý: ${error.message}"); window.history.back();</script>`);
    }
  },
};

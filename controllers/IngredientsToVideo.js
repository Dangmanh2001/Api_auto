const taskQueue = require("../utils/taskQueue");

module.exports = {
  IngredientsToVideo: async (req, res) => {
    res.render("IngredientsToVideo.ejs");
  },

  IngredientsToVideoPost: async (req, res) => {
    try {
      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;
      const agentId = req.body.agentId || null;
      const prompts = req.body.prompts;
      const promptList = Array.isArray(prompts) ? prompts : [prompts];

      const allFiles = req.files || [];
      const ingredients = promptList.map((prompt, index) => {
        const fieldName = `images_${index + 1}[]`;
        const imageNames = allFiles
          .filter((file) => file.fieldname === fieldName)
          .map((file) => file.originalname);
        return { prompt, imageNames };
      });

      taskQueue.create("ingredients-to-video", { aspectRatio, modelType, ingredients }, agentId);
      return res.redirect("/api/IngredientsToVideo");
    } catch (error) {
      console.error(error);
      res.status(500).send("Lỗi xử lý dữ liệu");
    }
  },
};

const axios = require("axios");
const { HttpsProxyAgent } = require("https-proxy-agent");
const { GoogleGenAI } = require("@google/genai");
const taskQueue = require("../utils/taskQueue");

module.exports = {
  TextToVideoveo3Api: async (req, res) => {
    res.render("TextToVideo.ejs");
  },

  TextToVideoveo3ApiPost: async (req, res) => {
    try {
      const aspectRatio = req.body.aspectRatio;
      const modelType = req.body.modelType;
      const agentId = req.body.agentId || null;
      const rawPrompts = req.body.prompts;
      const promptList = rawPrompts
        ? rawPrompts
            .split("\n")
            .map((p) => p.trim())
            .filter((p) => p !== "")
        : [];

      taskQueue.create(
        "text-to-video",
        { aspectRatio, modelType, promptList },
        agentId,
      );
      return res.redirect("/api");
    } catch (error) {
      console.error("❌ Lỗi tạo task:", error.message);
      return res.status(500).json({ success: false, message: error.message });
    }
  },

  gemini: async (req, res) => {
    res.render("gemini.ejs");
  },

  postGemini: async (req, res) => {
    try {
      const { youtubeUrl, prompt } = req.body;
      if (!youtubeUrl)
        return res.status(400).json({ error: "Thiếu URL YouTube" });

      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [
          {
            role: "user",
            parts: [
              {
                text:
                  prompt ||
                  "Phân tích nội dung video này chi tiết bằng tiếng Việt.",
              },
              { fileData: { fileUri: youtubeUrl, mimeType: "video/mp4" } },
            ],
          },
        ],
      });

      return res.json({ result: response.text });
    } catch (err) {
      console.error("Gemini error:", err.message);
      return res.status(500).json({ error: err.message });
    }
  },
};

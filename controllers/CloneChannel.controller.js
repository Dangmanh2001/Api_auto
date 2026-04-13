const axios = require("axios");
// youtube-transcript là ESM package — dùng dynamic import() bên trong hàm async
const { GoogleGenAI } = require("@google/genai");

// Header giả lập trình duyệt thường để tránh bị chặn
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "vi-VN,vi;q=0.9,en;q=0.8",
};

// Chuẩn hoá input thành URL trang /videos của kênh
function buildChannelUrl(input) {
  input = input.trim().replace(/\/$/, "");
  if (input.startsWith("UC") && input.length > 20)
    return `https://www.youtube.com/channel/${input}/videos`;
  if (input.includes("youtube.com")) {
    // Thêm /videos nếu chưa có
    if (!input.includes("/videos")) input += "/videos";
    if (!input.startsWith("http")) input = "https://" + input;
    return input;
  }
  // @handle hoặc handle thuần
  const handle = input.startsWith("@") ? input : "@" + input;
  return `https://www.youtube.com/${handle}/videos`;
}

// Trích xuất ytInitialData từ HTML trang YouTube
function extractYtData(html) {
  const match = html.match(/var ytInitialData\s*=\s*(\{.+?\});\s*<\/script>/s);
  if (!match)
    throw new Error("Không tìm thấy dữ liệu YouTube trên trang. Thử lại sau.");
  return JSON.parse(match[1]);
}

// Lấy danh sách video từ ytInitialData của trang /videos
function extractVideos(ytData) {
  try {
    const tabs = ytData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const videosTab = tabs.find(
      (t) =>
        t?.tabRenderer?.title === "Videos" || t?.tabRenderer?.title === "Video",
    );
    const contents =
      videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];

    return contents
      .filter((c) => c?.richItemRenderer?.content?.videoRenderer)
      .map((c) => {
        const v = c.richItemRenderer.content.videoRenderer;
        const id = v.videoId;
        const title = v.title?.runs?.[0]?.text || "";
        const thumb = v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || "";
        const duration =
          v.lengthText?.simpleText ||
          v.lengthText?.accessibility?.accessibilityData?.label ||
          "";
        const views =
          v.viewCountText?.simpleText ||
          v.viewCountText?.runs?.map((r) => r.text).join("") ||
          "";
        const date = v.publishedTimeText?.simpleText || "";
        return { id, title, thumb, duration, views, date };
      });
  } catch {
    return [];
  }
}

// Lấy thông tin kênh từ ytInitialData
function extractChannelInfo(ytData) {
  try {
    const header =
      ytData?.header?.pageHeaderRenderer ||
      ytData?.header?.c4TabbedHeaderRenderer;

    const title =
      header?.pageTitle ||
      header?.title ||
      ytData?.metadata?.channelMetadataRenderer?.title ||
      "";

    const thumbs =
      header?.avatar?.thumbnails ||
      header?.content?.pageHeaderViewModel?.image?.decoratedAvatarViewModel
        ?.avatar?.avatarViewModel?.image?.sources ||
      [];
    const thumbnail = thumbs?.[thumbs.length - 1]?.url || "";

    const metadata = ytData?.metadata?.channelMetadataRenderer;
    const description = metadata?.description || "";

    // subscriber count
    const subText =
      header?.subscriberCountText?.simpleText ||
      header?.content?.pageHeaderViewModel?.metadata?.contentMetadataViewModel?.metadataRows
        ?.flatMap((r) => r?.metadataParts || [])
        ?.find(
          (p) =>
            p?.text?.content?.includes("subscriber") ||
            p?.text?.content?.includes("người đăng ký"),
        )?.text?.content ||
      "";

    return { title, thumbnail, description, subscribers: subText };
  } catch {
    return { title: "", thumbnail: "", description: "", subscribers: "" };
  }
}

// Lấy continuation token để tải thêm video
function extractContinuation(ytData) {
  try {
    const tabs = ytData?.contents?.twoColumnBrowseResultsRenderer?.tabs || [];
    const videosTab = tabs.find(
      (t) =>
        t?.tabRenderer?.title === "Videos" || t?.tabRenderer?.title === "Video",
    );
    const contents =
      videosTab?.tabRenderer?.content?.richGridRenderer?.contents || [];
    const cont = contents.find((c) => c?.continuationItemRenderer);
    return (
      cont?.continuationItemRenderer?.continuationEndpoint?.continuationCommand
        ?.token || null
    );
  } catch {
    return null;
  }
}

// Tải thêm video qua API nội bộ của YouTube (không cần key)
async function fetchMoreVideos(continuationToken) {
  const res = await axios.post(
    "https://www.youtube.com/youtubei/v1/browse",
    {
      context: {
        client: { clientName: "WEB", clientVersion: "2.20240415.00.00" },
      },
      continuation: continuationToken,
    },
    { headers: HEADERS },
  );

  const items =
    res.data?.onResponseReceivedActions?.[0]?.appendContinuationItemsAction
      ?.continuationItems || [];

  const videos = items
    .filter((c) => c?.richItemRenderer?.content?.videoRenderer)
    .map((c) => {
      const v = c.richItemRenderer.content.videoRenderer;
      return {
        id: v.videoId,
        title: v.title?.runs?.[0]?.text || "",
        thumb: v.thumbnail?.thumbnails?.slice(-1)?.[0]?.url || "",
        duration: v.lengthText?.simpleText || "",
        views:
          v.viewCountText?.simpleText ||
          v.viewCountText?.runs?.map((r) => r.text).join("") ||
          "",
        date: v.publishedTimeText?.simpleText || "",
      };
    });

  const cont = items.find((c) => c?.continuationItemRenderer);
  const nextToken =
    cont?.continuationItemRenderer?.continuationEndpoint?.continuationCommand
      ?.token || null;

  return { videos, nextToken };
}

// Lấy mô tả + tags của 1 video (scrape trang watch)
async function fetchVideoDetail(videoId) {
  const res = await axios.get(`https://www.youtube.com/watch?v=${videoId}`, {
    headers: HEADERS,
  });
  const html = res.data;

  // description
  const descMatch = html.match(/"shortDescription":"((?:[^"\\]|\\.)*)"/);
  let description = "";
  if (descMatch) {
    description = descMatch[1]
      .replace(/\\n/g, "\n")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }

  // tags
  const tagsMatch = html.match(/"keywords":\[(.*?)\]/);
  let tags = [];
  if (tagsMatch) {
    try {
      tags = JSON.parse("[" + tagsMatch[1] + "]");
    } catch {
      tags = [];
    }
  }

  return { description, tags };
}

// ===================== EXPORTS =====================

module.exports = {
  getPage: (_req, res) => res.render("CloneChannel"),

  // GET /api/clone-channel/fetch?channel=...&continuation=...
  fetchChannel: async (req, res) => {
    const { channel, continuation } = req.query;
    if (!channel && !continuation)
      return res.status(400).json({ error: "Thiếu tham số channel" });

    try {
      // Tải thêm (trang 2+)
      if (continuation) {
        const { videos, nextToken } = await fetchMoreVideos(continuation);
        return res.json({ videos, nextToken });
      }

      // Trang đầu: scrape HTML
      const url = buildChannelUrl(channel);
      const pageRes = await axios.get(url, { headers: HEADERS });
      const ytData = extractYtData(pageRes.data);

      const channelInfo = extractChannelInfo(ytData);
      const videos = extractVideos(ytData);
      const nextToken = extractContinuation(ytData);

      return res.json({ channel: channelInfo, videos, nextToken });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  // GET /api/clone-channel/detail?videoId=...
  fetchDetail: async (req, res) => {
    const { videoId } = req.query;
    if (!videoId) return res.status(400).json({ error: "Thiếu videoId" });
    try {
      const detail = await fetchVideoDetail(videoId);
      return res.json(detail);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },

  // GET /api/clone-channel/transcript?videoId=...
  getTranscript: async (req, res) => {
    const { videoId } = req.query;
    console.log(videoId);
    if (!videoId) return res.status(400).json({ error: "Thiếu videoId" });

    try {
      const { YoutubeTranscript } = await import("youtube-transcript");
      const transcript = await Promise.any([
        YoutubeTranscript.fetchTranscript(videoId, { lang: "vi" }),
        YoutubeTranscript.fetchTranscript(videoId, { lang: "en" }),
        YoutubeTranscript.fetchTranscript(videoId),
      ]);
      const text = transcript.map((t) => t.text).join(" ");
      return res.json({ transcript: text, source: "subtitle" });
    } catch {
      // Không có phụ đề → fallback: dùng Gemini đọc nội dung video trực tiếp
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const response = await ai.models.generateContent({
          model: "gemini-3.1-flash-lite-preview",
          contents: [
            {
              role: "user",
              parts: [
                {
                  fileData: {
                    fileUri: `https://www.youtube.com/watch?v=${videoId}`,
                  },
                },
                {
                  text: "Hãy lấy toàn bộ nội dung lời thoại (transcript) của video này. Chỉ trả về phần lời nói, không thêm nhận xét hay giải thích gì thêm.",
                },
              ],
            },
          ],
        });
        return res.json({ transcript: response.text, source: "gemini" });
      } catch (geminiErr) {
        return res.status(500).json({
          error:
            "Video không có phụ đề và Gemini không đọc được nội dung: " +
            geminiErr.message,
        });
      }
    }
  },

  // POST /api/clone-channel/analyze  { transcript, action }
  analyzeTranscript: async (req, res) => {
    const { transcript, action } = req.body;
    console.log(action);
    if (!transcript) return res.status(400).json({ error: "Thiếu transcript" });

    const PROMPTS = {
      rewrite:
        "Dựa vào script/transcript video dưới đây, hãy viết lại thành một kịch bản video mới hoàn chỉnh bằng tiếng Việt. Giữ nguyên ý tưởng cốt lõi nhưng thay đổi cách diễn đạt, cấu trúc và phong cách. Chia rõ phần mở đầu (hook), nội dung chính, kết thúc (CTA).\n\nTRANSCRIPT:\n",
      analyze:
        "Phân tích chiến lược nội dung của video dựa trên transcript sau. Hãy chỉ ra: 1) Hook mở đầu họ dùng, 2) Cấu trúc nội dung, 3) Điểm mạnh về storytelling, 4) CTA cuối video, 5) Từ khoá chủ đạo, 6) Bài học có thể áp dụng. Trả lời bằng tiếng Việt.\n\nTRANSCRIPT:\n",
      seo: "Từ transcript video sau, hãy tạo ra:\n1. 5 gợi ý tiêu đề video hấp dẫn, tối ưu SEO YouTube (tiếng Việt)\n2. Mô tả video (description) chuẩn SEO ~300 từ bằng tiếng Việt\n3. 20 tags YouTube liên quan\n\nTRANSCRIPT:\n",
      translate:
        "Dịch toàn bộ transcript sau sang tiếng Việt tự nhiên, trôi chảy như người Việt nói chuyện. Giữ nguyên cấu trúc câu và không bỏ sót ý nào.\n\nTRANSCRIPT:\n",
      thumbnail:
        "Từ transcript video sau, hãy tìm ra:\n1. 5 câu/cụm từ ngắn gọn, gây tò mò nhất để dùng làm text thumbnail\n2. 3 ý tưởng thumbnail (mô tả hình ảnh + text overlay)\n3. Hook câu mở đầu video hay nhất\n\nTRANSCRIPT:\n",
    };

    const prompt = (PROMPTS[action] || PROMPTS.analyze) + transcript;

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const response = await ai.models.generateContent({
        model: "gemini-3.1-flash-lite-preview",
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      });
      return res.json({ result: response.text });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  },
};

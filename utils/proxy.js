const { connect } = require("puppeteer-real-browser");
const fs = require("fs");
const path = require("path");

// Tìm Chrome trên Windows
function findChrome() {
  const paths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(
      process.env.LOCALAPPDATA || "",
      "Google\\Chrome\\Application\\chrome.exe",
    ),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

// 👉 Tạo browser dùng puppeteer-real-browser (bypass bot detection tốt hơn)
async function createBrowserWithProxy() {
  const userDataDir = process.env.CHROME_PROFILE || "./flow-profile";
  console.log(`📁 Profile: ${userDataDir}`);

  const executablePath = findChrome();
  if (executablePath) {
    console.log(`✅ Chrome: ${executablePath}`);
  }

  const options = {
    headless: false,
    turnstile: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    customConfig: {
      userDataDir: path.resolve(userDataDir),
    },
    connectOption: { defaultViewport: null },
    disableXvfb: true,
    ignoreAllFlags: false,
  };

  if (executablePath) {
    options.executablePath = executablePath;
  }

  const { browser, page } = await connect(options);
  console.log("🚀 Browser đã khởi động (real-browser mode)");

  return { browser, page };
}

// Giữ nguyên export getNextProxy để không break code cũ
async function getNextProxy() {
  return null;
}

module.exports = { createBrowserWithProxy, getNextProxy };

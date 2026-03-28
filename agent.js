/**
 * AGENT.JS — File độc lập, chạy trên máy CLIENT
 * ================================================
 * Yêu cầu (chỉ cần làm 1 lần):
 *   1. Cài Node.js: https://nodejs.org
 *   2. Tạo thư mục, đặt file này vào, rồi chạy:
 *        npm init -y && npm install axios puppeteer-real-browser
 *   3. Chạy agent:
 *        node agent.js http://192.168.1.89:3000
 *
 * Lần đầu Chrome mở sẽ cần đăng nhập Google thủ công (1 lần duy nhất).
 */

const axios = require("axios");
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { connect } = require("puppeteer-real-browser");

// ==================== CONFIG ====================
const SERVER_URL = (process.argv[2] || "http://localhost:3000").replace(/\/$/, "");
const CHROME_PROFILE = process.argv[3] || path.join(__dirname, "flow-profile");
const AGENT_NAME = os.hostname();
const POLL_INTERVAL = 3000;

// ==================== HELPERS ====================
const rnd = (min, max) => Math.random() * (max - min) + min;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const paths = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    path.join(process.env.LOCALAPPDATA || "", "Google\\Chrome\\Application\\chrome.exe"),
  ];
  for (const p of paths) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function createBrowser() {
  console.log(`📁 Chrome profile: ${CHROME_PROFILE}`);
  const executablePath = findChrome();
  if (executablePath) console.log(`✅ Chrome: ${executablePath}`);

  const options = {
    headless: false,
    turnstile: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-first-run",
      "--no-default-browser-check",
    ],
    customConfig: { userDataDir: path.resolve(CHROME_PROFILE) },
    connectOption: { defaultViewport: null },
    disableXvfb: true,
    ignoreAllFlags: false,
  };
  if (executablePath) options.executablePath = executablePath;

  const { browser, page } = await connect(options);
  console.log("🚀 Chrome đã khởi động");
  return { browser, page };
}

async function humanType(page, selector, text) {
  await page.focus(selector);
  await page.keyboard.down("Control");
  await page.keyboard.press("a");
  await page.keyboard.up("Control");
  await sleep(rnd(80, 150));
  await page.keyboard.press("Backspace");
  await sleep(rnd(100, 200));
  for (const char of text) {
    await page.keyboard.type(char);
    if (Math.random() < 0.05) await sleep(rnd(300, 800));
    else await sleep(rnd(40, 130));
  }
}

async function humanMouseWander(page) {
  await page.mouse.move(rnd(200, 1200), rnd(100, 700), { steps: Math.floor(rnd(10, 25)) });
  await sleep(rnd(200, 600));
}

async function clickAndVerify(page, xpath, description) {
  await page.locator(xpath).click();
  await sleep(500);
  const ok = await page.evaluate((sel) => {
    const el = document.evaluate(sel.replace("xpath/", ""), document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    if (!el) return false;
    return el.getAttribute("data-state") === "active" || el.getAttribute("aria-selected") === "true" || el.classList.contains("active");
  }, xpath);
  console.log(`[${description}] ${ok ? "✅" : "❌"}`);
}

function minimizeChrome() {
  const { exec } = require("child_process");
  exec(
    `powershell -command "Add-Type @'\nusing System;\nusing System.Runtime.InteropServices;\npublic class Win32 {\n  [DllImport(\\"user32.dll\\")] public static extern bool ShowWindow(IntPtr h, int n);\n  [DllImport(\\"user32.dll\\")] public static extern IntPtr GetForegroundWindow();\n}\n'@; [Win32]::ShowWindow([Win32]::GetForegroundWindow(), 2)"`,
    (err) => { if (!err) console.log("🪟 Chrome minimize!"); }
  );
}

async function blockEditNavigation(page) {
  await page.evaluate(() => {
    if (window.__editBlocked) return;
    window.__editBlocked = true;
    document.addEventListener("click", (e) => {
      const a = e.target.closest('a[href*="/edit/"]');
      if (a) { e.preventDefault(); e.stopImmediatePropagation(); }
    }, true);
  });
}

async function setupPage(page, aspectRatio, modelType, mode = "Khung hình") {
  await page.goto("https://labs.google/fx/vi/tools/flow", { waitUntil: "networkidle2", timeout: 60000 });
  if (page.url().includes("accounts.google.com")) {
    console.log("⚠️ Chưa login — vui lòng đăng nhập thủ công trong Chrome...");
    await page.waitForFunction(() => !window.location.href.includes("accounts.google.com"), { timeout: 5 * 60 * 1000 });
    console.log("✅ Đã login!");
  }
  await page.waitForFunction(
    () => [...document.querySelectorAll("button")].some((btn) => btn.textContent?.includes("Dự án mới")),
    { timeout: 60000 }
  );
  await page.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes("Dự án mới"));
    if (btn) { btn.scrollIntoView({ block: "center" }); btn.click(); }
  });
  console.log("Đã click Dự án mới");
  try {
    await page.locator('xpath///button[.//span[text()="Tạo"]]/preceding-sibling::button').click().catch(() => {});
    await sleep(600);
    await page.click('button.flow_tab_slider_trigger[aria-controls*="VIDEO"]');
    await clickAndVerify(page, `xpath///button[contains(., '${mode}')]`, `Chọn ${mode}`);
    await clickAndVerify(page, `xpath///button[contains(., '${aspectRatio}')]`, "Chọn Khung hình");
    const dropdownBtn = "xpath///button[@aria-haspopup='menu' and contains(., 'Veo 3.1')]";
    await page.waitForSelector(dropdownBtn, { visible: true });
    await page.click(dropdownBtn);
    await page.waitForSelector("div[role='menu'][data-state='open']", { visible: true });
    const optionXpath = `xpath///div[@role='menuitem']//span[contains(text(), '${modelType}')]`;
    await page.waitForSelector(optionXpath, { visible: true });
    await page.click(optionXpath);
    console.log("✅ Đã chọn Model");
    await page.click("button.flow_tab_slider_trigger::-p-text(x1)");
  } catch {
    console.log("Có lỗi setup, tiếp tục...");
  }
}

async function waitForVideos(page, expectedCount) {
  const getTileCount = () => page.evaluate(() => {
    const items = document.querySelectorAll("[data-item-index]");
    if (!items.length) return 0;
    const maxIndex = Math.max(...[...items].map((el) => parseInt(el.getAttribute("data-item-index") || "0")));
    return (maxIndex + 1) * 2;
  });

  const tilesBefore = await getTileCount();
  const expectedTiles = tilesBefore + expectedCount;
  let stableCount = 0;
  const STABLE_NEEDED = 3;
  const TIMEOUT_MS = 10 * 60 * 1000; // tối đa 10 phút
  const startTime = Date.now();
  let lastLogTiles = -1;

  console.log(`⏳ Chờ render: ${tilesBefore} → ${expectedTiles} tiles`);

  while (true) {
    await sleep(rnd(2500, 5000));

    // Timeout thoát vòng lặp nếu stuck quá lâu
    if (Date.now() - startTime > TIMEOUT_MS) {
      console.log("⏰ Timeout 10 phút — bỏ qua batch này");
      break;
    }

    const currentTiles = await getTileCount();

    // Chỉ log khi tiles thay đổi
    if (currentTiles !== lastLogTiles) {
      console.log(`📊 Tiles: ${currentTiles}/${expectedTiles}`);
      lastLogTiles = currentTiles;
    }

    const retryList = [];
    for (const btn of await page.$$("button")) {
      const text = await btn.evaluate((el) => el.innerText).catch(() => "");
      if (text.trim() === "Thử lại") retryList.push(btn);
    }
    if (retryList.length > 0) {
      stableCount = 0;
      const pick = retryList[Math.floor(Math.random() * retryList.length)];
      await pick.evaluate((el) => el.scrollIntoView({ block: "center", behavior: "smooth" }));
      await sleep(rnd(600, 1000));
      await pick.evaluate((btn) => btn.dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true })));
      console.log(`⚠️ Bấm Thử lại (${retryList.length} nút)`);
      await sleep(rnd(500, 1000));
      continue;
    }

    const isLoading = await page.evaluate(() =>
      document.querySelector('[class*="generating"], [class*="spinner"], [aria-busy="true"]') !== null
    );

    if (isLoading) {
      stableCount = 0;
    } else {
      stableCount++;
      if (stableCount >= STABLE_NEEDED && currentTiles >= expectedTiles) {
        console.log("✅ Render xong!");
        break;
      }
    }
  }
}

// Tải file từ server về thư mục tạm
async function downloadFile(filename, destDir) {
  const url = `${SERVER_URL}/uploads/${encodeURIComponent(filename)}`;
  const destPath = path.join(destDir, filename);
  if (fs.existsSync(destPath)) return destPath;
  const res = await axios.get(url, { responseType: "arraybuffer" });
  fs.writeFileSync(destPath, Buffer.from(res.data));
  console.log(`⬇️ Đã tải: ${filename}`);
  return destPath;
}

// ==================== RUN FUNCTIONS ====================

async function runTextToVideo(params, log) {
  const { aspectRatio, modelType, promptList } = params;
  const { browser, page } = await createBrowser();
  try {
    await setupPage(page, aspectRatio, modelType, "Khung hình");
    minimizeChrome();
    await blockEditNavigation(page);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) blockEditNavigation(page).catch(() => {});
    });

    const BATCH_SIZE = Math.floor(rnd(3, 6));
    for (let i = 0; i < promptList.length; i += BATCH_SIZE) {
      const batch = promptList.slice(i, i + BATCH_SIZE);
      log(`📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} prompt`);

      for (const prompt of batch) {
        await page.waitForSelector('[role="textbox"]', { visible: true, timeout: 60000 });
        await humanMouseWander(page);
        await sleep(rnd(300, 700));
        await humanType(page, '[role="textbox"]', prompt);
        await sleep(rnd(500, 1200));
        const createBtn = await page.$("button ::-p-text(Tạo)");
        if (createBtn) {
          await createBtn.evaluate((btn) => btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
        }
        log(`✅ Submit: ${prompt.substring(0, 40)}...`);
        await sleep(rnd(1200, 2500));
      }

      log(`⏳ Đợi ${batch.length} video render...`);
      await waitForVideos(page, batch.length);
      log("🚀 Batch xong!");
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runImageToVideo(params, log) {
  const { aspectRatio, modelType, tasks } = params;
  const tmpDir = path.join(os.tmpdir(), "flow-agent-images");
  fs.mkdirSync(tmpDir, { recursive: true });

  const { browser, page } = await createBrowser();
  try {
    await setupPage(page, aspectRatio, modelType, "Khung hình");
    minimizeChrome();
    await blockEditNavigation(page);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) blockEditNavigation(page).catch(() => {});
    });

    for (const task of tasks) {
      log(`🖼️ Xử lý: ${task.prompt.substring(0, 40)}...`);

      const startPath = await downloadFile(task.startImageName, tmpDir);
      const imagePaths = [startPath];
      if (task.endImageName) imagePaths.push(await downloadFile(task.endImageName, tmpDir));

      await page.waitForSelector('input[type="file"]', { timeout: 30000 });
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        const oldCount = await page.evaluate(() => document.querySelectorAll('img[src*="getMediaUrlRedirect"]').length);
        await fileInput.uploadFile(...imagePaths);
        await page.waitForFunction(
          (old, count) => document.querySelectorAll('img[src*="getMediaUrlRedirect"]').length >= old + count,
          { timeout: 120000 }, oldCount, imagePaths.length
        );
        log("✅ Upload ảnh xong");
      }

      async function selectImage(buttonText, fileName) {
        await page.waitForFunction(
          (text) => [...document.querySelectorAll("div")].some((el) => el.textContent?.trim() === text),
          {}, buttonText
        );
        await page.evaluate((text) => {
          const btn = [...document.querySelectorAll("div")].find((el) => el.textContent?.trim() === text);
          if (btn) btn.click();
        }, buttonText);
        await page.waitForSelector(`img[alt="${fileName}"]`, { timeout: 10000 });
        await page.click(`img[alt="${fileName}"]`);
        log(`Đã chọn: ${fileName}`);
      }

      await selectImage("Bắt đầu", task.startImageName);
      if (task.endImageName) await selectImage("Kết thúc", task.endImageName);

      await page.waitForSelector('[role="textbox"]', { visible: true, timeout: 60000 });
      await humanType(page, '[role="textbox"]', task.prompt);
      await sleep(rnd(500, 1200));

      const createBtn = await page.$("button ::-p-text(Tạo)");
      if (createBtn) {
        await createBtn.evaluate((btn) => btn.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
      }
      log("✅ Click Tạo");
      await waitForVideos(page, 1);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

async function runIngredientsToVideo(params, log) {
  const { aspectRatio, modelType, ingredients } = params;
  const tmpDir = path.join(os.tmpdir(), "flow-agent-images");
  fs.mkdirSync(tmpDir, { recursive: true });

  const { browser, page } = await createBrowser();
  try {
    await setupPage(page, aspectRatio, modelType, "Thành phần");
    minimizeChrome();
    await blockEditNavigation(page);
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) blockEditNavigation(page).catch(() => {});
    });

    for (const item of ingredients) {
      log(`🧪 Ingredient: ${item.prompt.substring(0, 40)}...`);

      const localPaths = [];
      for (const name of item.imageNames) {
        localPaths.push(await downloadFile(name, tmpDir));
      }

      await page.waitForSelector('input[type="file"]', { timeout: 30000 });
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        const oldCount = await page.evaluate(() => document.querySelectorAll('img[src*="getMediaUrlRedirect"]').length);
        await fileInput.uploadFile(...localPaths);
        await page.waitForFunction(
          (old, count) => document.querySelectorAll('img[src*="getMediaUrlRedirect"]').length >= old + count,
          { timeout: 120000 }, oldCount, localPaths.length
        );
        log("✅ Upload ảnh xong");
      }

      for (const name of item.imageNames) {
        const btn = await page.waitForSelector(`xpath///button[.//span[text()='Tạo']]`);
        await btn.click();
        await page.waitForFunction(
          (n) => [...document.querySelectorAll("img")].some((img) => img.alt === n),
          { timeout: 10000 }, name
        );
        await page.evaluate((n) => {
          const img = [...document.querySelectorAll("img")].find((i) => i.alt === n);
          if (img) img.click();
        }, name);
        log(`Đã chọn: ${name}`);
        await sleep(rnd(800, 1200));
      }

      await page.waitForSelector('[role="textbox"]', { visible: true, timeout: 60000 });
      await humanType(page, '[role="textbox"]', item.prompt);
      await sleep(rnd(500, 1200));

      const createBtn = await page.waitForSelector(`xpath///button[.//span[text()='Tạo'] and .//i[text()='arrow_forward']]`);
      await createBtn.evaluate((btn) => btn.dispatchEvent(new MouseEvent("click", { bubbles: false, cancelable: true })));
      log("✅ Click Tạo");
      await waitForVideos(page, 1);
    }
  } finally {
    await browser.close().catch(() => {});
  }
}

// ==================== POLL LOOP ====================
async function poll() {
  try {
    const { data } = await axios.get(
      `${SERVER_URL}/api/agent/poll?agent=${encodeURIComponent(AGENT_NAME)}`,
      { timeout: 5000 }
    );
    if (!data.task) return;

    const { id, type, params } = data.task;
    const log = (msg) => {
      console.log(msg);
      axios.post(`${SERVER_URL}/api/agent/log/${id}`, { msg }, { timeout: 3000 }).catch(() => {});
    };

    log(`🤖 [${AGENT_NAME}] Nhận task #${id}: ${type}`);

    try {
      if (type === "text-to-video") await runTextToVideo(params, log);
      else if (type === "image-to-video") await runImageToVideo(params, log);
      else if (type === "ingredients-to-video") await runIngredientsToVideo(params, log);
      else log(`❓ Không biết task type: ${type}`);

      await axios.post(`${SERVER_URL}/api/agent/finish/${id}`, { status: "done" }, { timeout: 3000 });
      log(`✅ Task #${id} hoàn thành!`);
    } catch (err) {
      await axios.post(`${SERVER_URL}/api/agent/finish/${id}`, { status: "failed", error: err.message }, { timeout: 3000 }).catch(() => {});
      console.error(`❌ Task #${id} thất bại:`, err.message);
    }
  } catch (err) {
    if (err.code !== "ECONNREFUSED" && err.code !== "ETIMEDOUT") {
      console.error("Poll error:", err.message);
    }
  }
}

// ==================== LOCAL DETECTOR SERVER ====================
// Browser trên máy này fetch http://localhost:3001 để lấy agentId
const localServer = http.createServer((_req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({ agentId: AGENT_NAME, ready: true }));
});
localServer.listen(3001, "127.0.0.1", () => {
  console.log(`🔌 Detector server tại http://localhost:3001`);
});

// ==================== MAIN ====================
console.log("=".repeat(50));
console.log(`🤖 Agent: ${AGENT_NAME}`);
console.log(`📡 Server: ${SERVER_URL}`);
console.log(`📁 Profile: ${CHROME_PROFILE}`);
console.log(`⏱️  Poll mỗi ${POLL_INTERVAL / 1000}s`);
console.log("=".repeat(50) + "\n");

poll();
setInterval(poll, POLL_INTERVAL);

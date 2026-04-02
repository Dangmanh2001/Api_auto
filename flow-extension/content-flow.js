// content-flow.js - chạy trên https://labs.google/fx/vi/tools/flow

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ==================== HELPERS ====================

async function waitFor(selector, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.querySelector(selector);
    if (el) return el;
    await sleep(200);
  }
  throw new Error(`Timeout: ${selector}`);
}

async function waitForXPath(xpath, timeout = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const el = document.evaluate(
      xpath,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (el) return el;
    await sleep(200);
  }
  throw new Error(`Timeout xpath: ${xpath}`);
}

async function waitForCondition(fn, timeout = 60000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    try {
      if (fn()) return;
    } catch {}
    await sleep(300);
  }
  console.warn("⚠️ waitForCondition timeout — tiếp tục");
}

// Click giả lập đầy đủ pointer/mouse events như người dùng thật
// React cần bubbles:true mới nhận được event
async function realClick(el) {
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  await sleep(rnd(200, 400));
  const rect = el.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };
  el.dispatchEvent(new PointerEvent("pointerover", opts));
  el.dispatchEvent(new MouseEvent("mouseover", opts));
  el.dispatchEvent(new PointerEvent("pointerenter", opts));
  el.dispatchEvent(new MouseEvent("mouseenter", opts));
  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", { ...opts, button: 0 }));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", { ...opts, button: 0 }));
  el.dispatchEvent(new MouseEvent("click", { ...opts, button: 0 }));
  await sleep(rnd(100, 300));
}

// Tìm button theo text content chứa
function findButtonByText(text) {
  return [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(text),
  );
}

// Gõ trong main world của trang qua CDP Runtime.evaluate
// React nhận đúng state vì execCommand chạy cùng world với React
async function humanType(_element, text) {
  await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "cdp-type", tabId: _currentTabId, text },
      (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve();
      },
    );
  });
  await sleep(rnd(200, 400));
}

// Tải file từ server qua background (tránh mixed content HTTPS→HTTP)
async function uploadFromServer(serverUrl, filenames, fileInput) {
  const dt = new DataTransfer();
  for (const name of filenames) {
    const url = `${serverUrl}/uploads/${encodeURIComponent(name)}`;
    const result = await new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({ action: "fetch-file", url }, (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve(res);
      });
    });
    const bytes = new Uint8Array(result.data);
    const blob = new Blob([bytes], { type: result.mime });
    dt.items.add(new File([blob], name, { type: result.mime }));
  }
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
}

// Click và verify state (giống clickAndVerify trong Puppeteer)
async function clickAndVerify(el, description) {
  await realClick(el);
  await sleep(500);
  const isSelected =
    el.getAttribute("data-state") === "active" ||
    el.getAttribute("aria-selected") === "true" ||
    el.classList.contains("active");
  console.log(
    `[${description}] ${isSelected ? "✅" : "❌ không verify được state"}`,
  );
}

// Chặn chuyển hướng vào link edit gây gián đoạn task
function blockEditNavigation() {
  if (window.__editBlocked) return;
  window.__editBlocked = true;
  document.addEventListener(
    "click",
    (e) => {
      const a = e.target.closest('a[href*="/edit/"]');
      if (a) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    },
    true,
  );
}

// Đếm số lượng video tiles đang có trên trang
function getTileCount() {
  const items = document.querySelectorAll("[data-item-index]");
  if (!items.length) return 0;
  const maxIndex = Math.max(
    ...[...items].map((el) =>
      parseInt(el.getAttribute("data-item-index") || "0"),
    ),
  );
  return (maxIndex + 1) * 2;
}

// ==================== SETUP PAGE ====================

async function setupPage(aspectRatio, modelType, mode) {
  // Đợi login nếu cần
  if (location.href.includes("accounts.google.com")) {
    console.log("⚠️ Cần đăng nhập...");
    await waitForCondition(
      () => !location.href.includes("accounts.google.com"),
      5 * 60 * 1000,
    );
  }

  // Đợi nút Dự án mới
  await waitForCondition(() => !!findButtonByText("Dự án mới"));
  const newBtn = findButtonByText("Dự án mới");
  newBtn.scrollIntoView({ block: "center" });
  await realClick(newBtn);
  console.log("Đã click Dự án mới");
  await sleep(600);

  try {
    // Mở menu chính (nút bên trái nút Tạo)
    const menuBtn = await waitForXPath(
      '//button[.//span[text()="Tạo"]]/preceding-sibling::button',
    );
    await realClick(menuBtn).catch(() => console.log("Menu có vẻ đã mở"));
    await sleep(600);

    // Tab Video
    const videoTab = await waitFor(
      'button.flow_tab_slider_trigger[aria-controls*="VIDEO"]',
    );
    await realClick(videoTab);
    await sleep(400);

    // Chọn mode: "Khung hình" hoặc "Thành phần"
    await waitForCondition(() => !!findButtonByText(mode));
    const modeBtn = findButtonByText(mode);
    await clickAndVerify(modeBtn, `Chọn ${mode}`);
    await sleep(400);

    // Chọn tỉ lệ khung hình
    await waitForCondition(() => !!findButtonByText(aspectRatio));
    const ratioBtn = findButtonByText(aspectRatio);
    await clickAndVerify(ratioBtn, `Chọn ${aspectRatio}`);
    await sleep(400);

    // Chọn model từ dropdown
    const dropdownBtn = await waitForXPath(
      '//button[@aria-haspopup="menu" and contains(., "Veo 3.1")]',
    );
    await realClick(dropdownBtn);
    await waitForCondition(
      () => !!document.querySelector("div[role='menu'][data-state='open']"),
    );
    await sleep(300);

    const optionEl = await waitForXPath(
      `//div[@role='menuitem']//span[contains(text(), '${modelType}')]`,
    );
    await realClick(optionEl);
    console.log("✅ Đã chọn Model");
    await sleep(400);

    // Chọn x1
    await waitForCondition(() => !!findButtonByText("x1"));
    await realClick(findButtonByText("x1"));
    await sleep(300);
  } catch (e) {
    console.log("Setup lỗi nhỏ, tiếp tục:", e.message);
  }

  console.log("✅ Setup xong, bắt đầu render...");
}

// ==================== WAIT FOR VIDEOS ====================

async function waitForVideos(expectedCount, log, tilesBeforeOverride = null) {
  const tilesBefore =
    tilesBeforeOverride !== null ? tilesBeforeOverride : getTileCount();
  const expectedTiles = tilesBefore + expectedCount;
  let stableCount = 0;
  const STABLE_NEEDED = 3;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const startTime = Date.now();
  let lastLogTiles = -1;

  log(`⏳ Chờ render: ${tilesBefore} → ${expectedTiles} tiles`);

  while (true) {
    await sleep(rnd(2500, 5000));

    if (Date.now() - startTime > TIMEOUT_MS) {
      log("⏰ Timeout 10 phút — bỏ qua");
      break;
    }

    const currentTiles = getTileCount();
    if (currentTiles !== lastLogTiles) {
      log(`📊 Tiles: ${currentTiles}/${expectedTiles}`);
      lastLogTiles = currentTiles;
    }

    // Bấm Thử lại nếu có
    const retryBtns = [...document.querySelectorAll("button")].filter((b) => {
      const btnText = b.textContent || "";
      // Kiểm tra xem nút có chứa text "Thử lại" (kể cả text ẩn) hoặc icon "refresh"
      return (
        btnText.includes("Thử lại") ||
        b.querySelector("i")?.textContent?.trim() === "refresh"
      );
    });

    if (retryBtns.length > 0) {
      stableCount = 0;
      log(
        `⚠️ Phát hiện ${retryBtns.length} video bị lỗi, đang tự động bấm Thử lại...`,
      );
      // Bấm nút đầu tiên lỗi tìm thấy
      const pick = retryBtns[0];
      await realClick(pick);
      await sleep(rnd(1500, 3000)); // Chờ UI phản hồi
      continue;
    }

    // Kiểm tra loading: class generating/spinner/aria-busy HOẶC BẤT KỲ leaf node nào trên trang đang hiện %
    const isLoading =
      !!document.querySelector(
        '[class*="generating"], [class*="spinner"], [aria-busy="true"]',
      ) ||
      [...document.querySelectorAll("*")]
        .filter((el) => el.childElementCount === 0 && el.textContent)
        .some((el) => /^\d+%$/.test(el.textContent.trim()));

    if (isLoading) {
      stableCount = 0;
    } else {
      stableCount++;
      if (stableCount >= STABLE_NEEDED && currentTiles >= expectedTiles) {
        log("✅ Render xong!");
        break;
      }
    }
  }
}

// ==================== TASK RUNNERS ====================

async function runTextToVideo(params, log) {
  const { aspectRatio, modelType, promptList } = params;
  await setupPage(aspectRatio, modelType, "Khung hình");
  blockEditNavigation();

  const tilesBefore = getTileCount();
  const BATCH_SIZE = rnd(3, 5);

  for (let i = 0; i < promptList.length; i += BATCH_SIZE) {
    const batch = promptList.slice(i, i + BATCH_SIZE);
    log(`📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} prompt`);

    for (const prompt of batch) {
      const textbox = await waitFor('[role="textbox"]');
      await sleep(rnd(300, 700));
      await humanType(textbox, prompt);
      await sleep(rnd(500, 1200));

      // Nút submit — có thể là icon arrow_forward hoặc text "Tạo"
      const createBtn =
        [...document.querySelectorAll("button")].find(
          (b) => b.querySelector("i")?.textContent?.trim() === "arrow_forward",
        ) ||
        [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Tạo",
        );

      if (createBtn) await realClick(createBtn);
      log(`✅ Đã gửi prompt: ${prompt.substring(0, 40)}...`);
      await sleep(rnd(1200, 2500));
    }

    await waitForVideos(batch.length, log, tilesBefore);
    log("🚀 Batch xong!");
  }
}

async function runImageToVideo(params, log, serverUrl) {
  const { aspectRatio, modelType, tasks } = params;
  await setupPage(aspectRatio, modelType, "Khung hình");
  blockEditNavigation();

  async function selectImage(buttonText, fileName) {
    await waitForCondition(() =>
      [...document.querySelectorAll("div")].some(
        (el) => el.textContent?.trim() === buttonText,
      ),
    );
    const btn = [...document.querySelectorAll("div")].find(
      (el) => el.textContent?.trim() === buttonText,
    );
    btn.click();
    log(`Đã click ${buttonText}`);
    await waitForCondition(
      () => !!document.querySelector(`img[alt="${fileName}"]`),
      30000,
    );
    await realClick(document.querySelector(`img[alt="${fileName}"]`));
    log(`Đã chọn: ${fileName}`);
  }

  const BATCH_SIZE = rnd(3, 5);
  const tilesBefore = getTileCount();

  for (let i = 0; i < tasks.length; i += BATCH_SIZE) {
    const batch = tasks.slice(i, i + BATCH_SIZE);
    log(`📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} task`);

    for (const task of batch) {
      log(`🖼️ Submit: ${task.prompt.substring(0, 40)}...`);

      const fileInput = await waitFor('input[type="file"]', 30000);
      const filenames = [task.startImageName];
      if (task.endImageName) filenames.push(task.endImageName);

      const oldImgCount = document.querySelectorAll(
        'img[src*="getMediaUrlRedirect"]',
      ).length;
      await uploadFromServer(serverUrl, filenames, fileInput);
      await waitForCondition(() => {
        const imgs = document.querySelectorAll(
          'img[src*="getMediaUrlRedirect"]',
        );
        return (
          imgs.length >= oldImgCount + filenames.length &&
          [...imgs].slice(-filenames.length).every((img) => img.complete)
        );
      }, 120000);
      log("✅ Upload xong");

      await selectImage("Bắt đầu", task.startImageName);
      if (task.endImageName) await selectImage("Kết thúc", task.endImageName);

      const textbox = await waitFor('[role="textbox"]');
      await humanType(textbox, task.prompt);
      await sleep(rnd(500, 1200));

      const createBtn = [...document.querySelectorAll("button")].find(
        (b) =>
          b.textContent?.trim() === "Tạo" ||
          b.querySelector("span")?.textContent?.trim() === "Tạo",
      );
      if (createBtn) await realClick(createBtn);
      log(`✅ Đã gửi prompt: ${task.prompt.substring(0, 30)}...`);

      // Chờ UI reset (input file xuất hiện lại) trước khi submit task tiếp theo
      if (task !== batch[batch.length - 1]) {
        await sleep(rnd(1200, 2000));
      }
    }

    await waitForVideos(batch.length, log, tilesBefore);
    log("🚀 Batch xong!");
  }
}

async function runIngredientsToVideo(params, log, serverUrl) {
  const { aspectRatio, modelType, ingredients } = params;
  await setupPage(aspectRatio, modelType, "Thành phần");
  blockEditNavigation();

  // Picker button: button có span "Tạo" nhưng KHÔNG có <i> (khác submit)
  // Submit button: button có cả <i>arrow_forward</i> và <span>Tạo</span>
  // Picker: button có bất kỳ span nào text="Tạo" và KHÔNG có <i>arrow_forward</i>
  // (giống XPath Puppeteer: //button[.//span[text()='Tạo']])
  function findPickerBtn() {
    return [...document.querySelectorAll("button")].find(
      (b) =>
        [...b.querySelectorAll("span")].some(
          (s) => s.textContent?.trim() === "Tạo",
        ) && b.querySelector("i")?.textContent?.trim() !== "arrow_forward",
    );
  }

  async function selectImageForSlot(name) {
    await waitForCondition(() => !!findPickerBtn(), 15000);
    findPickerBtn().click();
    log(`Đã click picker Tạo`);

    await waitForCondition(
      () =>
        [...document.querySelectorAll("img")].some((img) => img.alt === name),
      10000,
    );
    const img = [...document.querySelectorAll("img")].find(
      (img) => img.alt === name,
    );
    img.click();
    log(`Đã chọn: ${name}`);
    await sleep(rnd(800, 1200));
  }

  const BATCH_SIZE = rnd(3, 5);
  const tilesBefore = getTileCount();

  for (let i = 0; i < ingredients.length; i += BATCH_SIZE) {
    const batch = ingredients.slice(i, i + BATCH_SIZE);
    log(`📦 Batch ${Math.floor(i / BATCH_SIZE) + 1}: ${batch.length} item`);

    for (const item of batch) {
      log(`🧪 Ingredient: ${item.prompt.substring(0, 40)}...`);

      // Upload
      const fileInput = await waitFor('input[type="file"]', 30000);
      const oldImgCount = document.querySelectorAll(
        'img[src*="getMediaUrlRedirect"]',
      ).length;
      await uploadFromServer(serverUrl, item.imageNames, fileInput);
      await waitForCondition(() => {
        const imgs = document.querySelectorAll(
          'img[src*="getMediaUrlRedirect"]',
        );
        return (
          imgs.length >= oldImgCount + item.imageNames.length &&
          [...imgs].slice(-item.imageNames.length).every((img) => img.complete)
        );
      }, 120000);
      log("✅ Upload ảnh xong");

      // Chọn từng ảnh vào slot ingredient
      for (const name of item.imageNames) {
        await selectImageForSlot(name);
      }

      // Type prompt
      const textbox = await waitFor('[role="textbox"]');
      await humanType(textbox, item.prompt);
      await sleep(rnd(500, 1200));

      // Submit: button có <i>arrow_forward</i>
      const submitBtn = [...document.querySelectorAll("button")].find(
        (b) => b.querySelector("i")?.textContent?.trim() === "arrow_forward",
      );
      if (!submitBtn)
        throw new Error("Không tìm thấy nút submit (arrow_forward)");

      await realClick(submitBtn);
      log(`✅ Đã gửi ingredient: ${item.prompt.substring(0, 30)}...`);

      if (item !== batch[batch.length - 1]) {
        await sleep(rnd(1200, 2000));
      }
    }

    await waitForVideos(batch.length, log, tilesBefore);
    log("🚀 Batch xong!");
  }
}

// ==================== PORT LISTENER ====================
let _currentTabId = null;

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "flow-task") return;

  port.onMessage.addListener(async (msg) => {
    if (msg.action !== "run") return;

    const { taskId, type, params, serverUrl, tabId } = msg;
    _currentTabId = tabId;

    const log = (text) => {
      console.log(text);
      fetch(`${serverUrl}/api/agent/log/${taskId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ msg: text }),
      }).catch(() => {});
    };

    try {
      if (type === "text-to-video") await runTextToVideo(params, log);
      else if (type === "image-to-video")
        await runImageToVideo(params, log, serverUrl);
      else if (type === "ingredients-to-video")
        await runIngredientsToVideo(params, log, serverUrl);
      else throw new Error(`Không biết task type: ${type}`);

      port.postMessage({ type: "done" });
    } catch (err) {
      console.error("Task error:", err);
      port.postMessage({ type: "error", error: err.message });
    }
  });
});

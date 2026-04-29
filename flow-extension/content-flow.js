// content-flow.js - chạy trên https://labs.google/fx/vi/tools/flow

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function randomChance(probability) {
  return Math.random() < probability;
}

async function humanPause(range = [800, 1800], options = {}) {
  const [min, max] = range;
  await sleep(rnd(min, max));

  const {
    microPauseChance = 0.2,
    microPauseRange = [250, 700],
    longPauseChance = 0,
    longPauseRange = [4000, 9000],
  } = options;

  if (microPauseChance > 0 && randomChance(microPauseChance)) {
    await sleep(rnd(microPauseRange[0], microPauseRange[1]));
  }

  if (longPauseChance > 0 && randomChance(longPauseChance)) {
    await sleep(rnd(longPauseRange[0], longPauseRange[1]));
  }
}

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

function normalizeRenderCount(value) {
  if (value === undefined || value === null) return "x1";
  const raw = String(value).trim().toLowerCase();
  if (/^x[1-4]$/.test(raw)) return raw;
  if (/^[1-4]$/.test(raw)) return `x${raw}`;
  return "x1";
}

function findRenderCountButton(value) {
  const target = normalizeRenderCount(value);
  return [...document.querySelectorAll("button")].find(
    (b) => b.textContent?.trim().toLowerCase() === target,
  );
}

function setNativeInputValue(input, value) {
  if (!input) return;
  const prototype = Object.getPrototypeOf(input);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  descriptor?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

function getUploadedImageNodes() {
  return [...document.querySelectorAll("img")].filter((img) => {
    const src = img.getAttribute("src") || "";
    const alt = img.getAttribute("alt") || "";
    return (
      src.includes("getMediaUrlRedirect") ||
      src.startsWith("blob:") ||
      alt.trim().length > 0
    );
  });
}

function imageLooksReady(img) {
  return !!img && (img.complete || img.naturalWidth > 0);
}

async function waitForUploadedImages(names, timeout = 60000) {
  const beforeNodes = getUploadedImageNodes();
  const beforeSet = new Set(beforeNodes);

  await waitForCondition(() => {
    const currentNodes = getUploadedImageNodes();
    const namedReady = names.every((name) =>
      currentNodes.some((img) => {
        const alt = img.getAttribute("alt") || "";
        const src = img.getAttribute("src") || "";
        return (
          imageLooksReady(img) &&
          (alt === name ||
            alt.includes(name) ||
            src.includes(encodeURIComponent(name)))
        );
      }),
    );
    if (namedReady) return true;

    const newReadyCount = currentNodes.filter(
      (img) => !beforeSet.has(img) && imageLooksReady(img),
    ).length;
    return newReadyCount >= names.length;
  }, timeout);
}

function getIndexedItemCount() {
  const indexes = new Set();
  for (const el of document.querySelectorAll("[data-item-index]")) {
    const raw = el.getAttribute("data-item-index");
    const index = Number.parseInt(raw || "", 10);
    if (Number.isInteger(index)) indexes.add(index);
  }
  return indexes.size;
}

function resolveBatchSize(total, preferred = 4) {
  if (!Number.isFinite(total) || total <= 0) return 1;
  const size = Number.parseInt(preferred, 10);
  if (!Number.isInteger(size) || size <= 0) return Math.min(4, total);
  return Math.min(size, total);
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
  await humanPause([350, 900], {
    microPauseChance: 0.35,
    microPauseRange: [300, 900],
  });
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
  await humanPause([450, 1100], {
    microPauseChance: 0.15,
    microPauseRange: [200, 500],
  });
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
  return getIndexedItemCount();
}

function getIndexedItems() {
  return [...document.querySelectorAll("[data-item-index]")]
    .map((el) => ({
      el,
      index: Number.parseInt(el.getAttribute("data-item-index") || "", 10),
    }))
    .filter((item) => Number.isInteger(item.index))
    .sort((a, b) => a.index - b.index);
}

function getLastIndexedItem() {
  const items = getIndexedItems();
  return items.length ? items[items.length - 1].el : null;
}

function getTopVisibleIndexedItem() {
  const items = getIndexedItems()
    .map((item) => {
      const rect = item.el.getBoundingClientRect();
      return {
        ...item,
        rect,
      };
    })
    .filter(
      (item) =>
        item.rect.width > 0 &&
        item.rect.height > 0 &&
        item.rect.bottom > 0 &&
        item.rect.right > 0,
    )
    .sort((a, b) => {
      if (a.rect.top !== b.rect.top) return a.rect.top - b.rect.top;
      return a.rect.left - b.rect.left;
    });

  return items.length ? items[0].el : null;
}

function getTileSignature(tile) {
  if (!tile) return "";
  const index = tile.getAttribute("data-item-index") || "";
  const text = tile.textContent?.trim() || "";
  const media =
    tile.querySelector("video")?.getAttribute("src") ||
    tile.querySelector("img")?.getAttribute("src") ||
    "";
  return `${index}::${text}::${media}`;
}

function hasProgressText(root) {
  return [...root.querySelectorAll("*")]
    .filter((el) => el.childElementCount === 0 && el.textContent)
    .some((el) => /^\d+%$/.test(el.textContent.trim()));
}

function hasRetryButton(root) {
  return [...root.querySelectorAll("button")].some((b) => {
    const btnText = b.textContent || "";
    return (
      btnText.includes("Thử lại") ||
      b.querySelector("i")?.textContent?.trim() === "refresh"
    );
  });
}

function isVideoTileComplete(tile) {
  if (!tile) return false;
  if (
    tile.querySelector(
      '[class*="generating"], [class*="spinner"], [aria-busy="true"]',
    )
  ) {
    return false;
  }
  if (hasProgressText(tile)) return false;
  if (hasRetryButton(tile)) return false;
  return true;
}

// ==================== SETUP PAGE ====================

async function setupPage(aspectRatio, modelType, mode, renderCount = "x1") {
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
    await sleep(rnd(800, 1500));

    // Tab Video
    const videoTab = await waitFor(
      'button.flow_tab_slider_trigger[aria-controls*="VIDEO"]',
    );
    await realClick(videoTab);
    await sleep(rnd(1000, 2000));

    // Chọn mode: "Khung hình" hoặc "Thành phần"
    await waitForCondition(() => !!findButtonByText(mode));
    const modeBtn = findButtonByText(mode);
    await clickAndVerify(modeBtn, `Chọn ${mode}`);
    await sleep(rnd(1200, 2500));

    // Chọn tỉ lệ khung hình
    await waitForCondition(() => !!findButtonByText(aspectRatio));
    const ratioBtn = findButtonByText(aspectRatio);
    await clickAndVerify(ratioBtn, `Chọn ${aspectRatio}`);
    await sleep(rnd(1000, 1800));

    // Chọn model từ dropdown
    const dropdownBtn = await waitForXPath(
      '//button[@aria-haspopup="menu" and contains(., "Veo 3.1")]',
    );
    await realClick(dropdownBtn);
    await sleep(rnd(800, 1200));

    await waitForCondition(
      () => !!document.querySelector("div[role='menu'][data-state='open']"),
    );
    await sleep(300);

    const optionEl = await waitForXPath(
      `//div[@role='menuitem']//span[contains(text(), '${modelType}')]`,
    );
    await realClick(optionEl);
    console.log("✅ Đã chọn Model");
    await sleep(rnd(1000, 1500));

    // Chọn x1
    await waitForCondition(() => !!findButtonByText("1x"));
    await realClick(findButtonByText("1x"));
    await sleep(rnd(500, 1000));
  } catch (e) {
    console.log("Setup lỗi nhỏ, tiếp tục:", e.message);
  }

  console.log("✅ Setup xong, bắt đầu render...");
}

// ==================== WAIT FOR VIDEOS ====================

async function waitForVideos(_expectedCount, log, previousTopSignature = "") {
  let stableCount = 0;
  const STABLE_NEEDED = 3;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const startTime = Date.now();

  log("Chờ video đầu nhóm hoàn thành...");

  while (true) {
    await sleep(rnd(2500, 5000));

    if (Date.now() - startTime > TIMEOUT_MS) {
      log("Timeout 10 phút — bỏ qua");
      break;
    }

    const retryBtns = [...document.querySelectorAll("button")].filter((b) => {
      const btnText = b.textContent || "";
      return (
        btnText.includes("Thử lại") ||
        b.querySelector("i")?.textContent?.trim() === "refresh"
      );
    });

    if (retryBtns.length > 0) {
      stableCount = 0;
      log(
        `Phát hiện ${retryBtns.length} video bị lỗi, đang tự động bấm Thử lại...`,
      );
      await realClick(retryBtns[0]);
      await sleep(rnd(1500, 3000));
      continue;
    }

    const topTile = getTopVisibleIndexedItem();
    if (!topTile) {
      stableCount = 0;
      continue;
    }

    const currentTopSignature = getTileSignature(topTile);
    if (previousTopSignature && currentTopSignature === previousTopSignature) {
      stableCount = 0;
      continue;
    }

    if (!isVideoTileComplete(topTile)) {
      stableCount = 0;
      continue;
    }

    stableCount++;
    if (stableCount >= STABLE_NEEDED) {
      log("Render xong!");
      break;
    }
  }
}
// ==================== SETUP IMAGE PAGE ====================

async function setupImagePage(aspectRatio, modelType, renderCount = "x1") {
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
    await sleep(rnd(800, 1500));

    // Tab Hình ảnh
    const videoTab = await waitFor(
      'button.flow_tab_slider_trigger[aria-controls*="IMAGE"]',
    );
    await realClick(videoTab);
    await sleep(rnd(1000, 2000));

    // Chọn tỉ lệ khung hình
    await waitForCondition(() => !!findButtonByText(aspectRatio));
    const ratioBtn = findButtonByText(aspectRatio);
    await clickAndVerify(ratioBtn, `Chọn ${aspectRatio}`);
    await sleep(rnd(1200, 2000));

    // Chọn model từ dropdown
    const dropdownBtn = await waitForXPath(
      '//button[@aria-haspopup="menu" and .//i[text()="arrow_drop_down"]]',
    );
    await realClick(dropdownBtn);
    await sleep(rnd(800, 1500));

    await waitForCondition(
      () => !!document.querySelector("div[role='menu'][data-state='open']"),
    );
    await sleep(rnd(500, 1000));

    const optionEl = await waitForXPath(
      `//div[@role='menuitem']//span[contains(text(), '${modelType}')]`,
    );
    await realClick(optionEl);
    console.log("✅ Đã chọn Model");
    await sleep(rnd(1000, 2000));

    // Chọn số lượng x1/x2/x3/x4
    const targetRenderCount = normalizeRenderCount(renderCount);
    await waitForCondition(
      () =>
        !!findRenderCountButton(targetRenderCount) ||
        !!findRenderCountButton("x1"),
    );
    await realClick(
      findRenderCountButton(targetRenderCount) || findRenderCountButton("x1"),
    );
    await sleep(rnd(500, 1000));
    console.log(`✅ Đã chọn số lượng: ${targetRenderCount}`);
  } catch (e) {
    console.log("Setup lỗi nhỏ, tiếp tục:", e.message);
  }

  console.log("✅ Setup Image xong, bắt đầu render...");
}

// ==================== WAIT FOR IMAGES ====================

function getImageTileCount() {
  return getIndexedItemCount();
}

async function waitForImages(expectedCount, log, tilesBefore = 0) {
  const expectedTiles = tilesBefore + expectedCount;
  let stableCount = 0;
  const STABLE_NEEDED = 3;
  const TIMEOUT_MS = 5 * 60 * 1000;
  const startTime = Date.now();
  let lastLogTiles = -1;

  log(`⏳ Chờ render ảnh: ${tilesBefore} → ${expectedTiles} tiles`);

  while (true) {
    await sleep(rnd(2000, 4000));

    if (Date.now() - startTime > TIMEOUT_MS) {
      log("⏰ Timeout 5 phút — bỏ qua");
      break;
    }

    const currentTiles = getImageTileCount();
    if (currentTiles !== lastLogTiles) {
      log(`📊 Tiles: ${currentTiles}/${expectedTiles}`);
      lastLogTiles = currentTiles;
    }

    // Bấm Thử lại nếu có
    const retryBtns = [...document.querySelectorAll("button")].filter(
      (b) =>
        b.textContent?.includes("Thử lại") ||
        b.querySelector("i")?.textContent?.trim() === "refresh",
    );
    if (retryBtns.length > 0) {
      stableCount = 0;
      log(`⚠️ Phát hiện ${retryBtns.length} ảnh lỗi, đang Thử lại...`);
      await realClick(retryBtns[0]);
      await sleep(rnd(1500, 3000));
      continue;
    }

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
        log("✅ Render ảnh xong!");
        break;
      }
    }
  }
}

// ==================== TASK RUNNERS ====================

async function runTextToVideo(params, log) {
  const { aspectRatio, modelType, promptList, batchSize } = params;
  const renderCount = normalizeRenderCount(params.renderCount);
  await setupPage(aspectRatio, modelType, "Khung hình", renderCount);
  blockEditNavigation();

  const effectiveBatchSize = resolveBatchSize(
    promptList.length,
    batchSize ?? 4,
  );
  for (let i = 0; i < promptList.length; i += effectiveBatchSize) {
    const batch = promptList.slice(i, i + effectiveBatchSize);
    const groupNumber = Math.floor(i / effectiveBatchSize) + 1;
    const previousTopSignature = getTileSignature(getTopVisibleIndexedItem());
    log(`📦 Đang xử lý nhóm ${groupNumber} (${batch.length} prompts)`);

    for (const prompt of batch) {
      const textbox = await waitFor('[role="textbox"]');
      await humanPause([1500, 3200], {
        microPauseChance: 0.3,
        microPauseRange: [500, 1200],
      });
      await humanType(textbox, prompt);
      await humanPause([1500, 3200], {
        microPauseChance: 0.3,
        microPauseRange: [500, 1200],
      });

      const createBtn =
        [...document.querySelectorAll("button")].find(
          (b) => b.querySelector("i")?.textContent?.trim() === "arrow_forward",
        ) ||
        [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Tạo",
        );

      if (createBtn) await realClick(createBtn);
      log(`✅ Đã gửi prompt: ${prompt.substring(0, 30)}...`);
      await humanPause([6000, 13000], {
        microPauseChance: 0.35,
        microPauseRange: [800, 2000],
        longPauseChance: 0.18,
        longPauseRange: [12000, 24000],
      });
    }

    await waitForVideos(batch.length, log, previousTopSignature);
    log(`🚀 Đã hoàn thành nhóm ${groupNumber}`);
    await humanPause([7000, 15000], {
      microPauseChance: 0.25,
      microPauseRange: [1000, 2500],
      longPauseChance: 0.12,
      longPauseRange: [15000, 30000],
    });
  }
}

async function runImageToVideo(params, log, serverUrl) {
  const { aspectRatio, modelType, tasks, batchSize } = params;
  const renderCount = normalizeRenderCount(params.renderCount);
  await setupPage(aspectRatio, modelType, "Khung hình", renderCount);
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
    // ✅ THÊM ĐOẠN NÀY (click + nhập input)
    const inputSelector = 'input[placeholder*="Tìm kiếm"]';

    await waitForCondition(() => document.querySelector(inputSelector), 10000);

    const input = document.querySelector(inputSelector);

    input.click();
    setNativeInputValue(input, fileName);

    log(`Đã nhập tên ảnh vào ô tìm kiếm`);
    await waitForCondition(
      () => !!document.querySelector(`img[alt="${fileName}"]`),
      30000,
    );
    await realClick(document.querySelector(`img[alt="${fileName}"]`));
    log(`Đã chọn: ${fileName}`);
  }

  const effectiveBatchSize = resolveBatchSize(tasks.length, batchSize ?? 4);
  for (let i = 0; i < tasks.length; i += effectiveBatchSize) {
    const batch = tasks.slice(i, i + effectiveBatchSize);
    const groupNumber = Math.floor(i / effectiveBatchSize) + 1;
    const previousTopSignature = getTileSignature(getTopVisibleIndexedItem());
    log(`📦 Đang xử lý nhóm ${groupNumber} (${batch.length} image tasks)`);

    for (const task of batch) {
      log(`🖼️ Submit: ${task.prompt.substring(0, 40)}...`);

      const fileInput = await waitFor('input[type="file"]', 30000);
      const filenames = [task.startImageName];
      if (task.endImageName) filenames.push(task.endImageName);

      await uploadFromServer(serverUrl, filenames, fileInput);
      await waitForUploadedImages(filenames, 60000);
      log("✅ Upload xong");

      await selectImage("Bắt đầu", task.startImageName);
      if (task.endImageName) await selectImage("Kết thúc", task.endImageName);

      const textbox = await waitFor('[role="textbox"]');
      await humanType(textbox, task.prompt);
      await humanPause([1500, 3200], {
        microPauseChance: 0.3,
        microPauseRange: [500, 1200],
      });

      const createBtn = [...document.querySelectorAll("button")].find(
        (b) =>
          b.textContent?.trim() === "Tạo" ||
          b.querySelector("span")?.textContent?.trim() === "Tạo",
      );
      if (createBtn) await realClick(createBtn);
      log(`✅ Đã gửi prompt: ${task.prompt.substring(0, 30)}...`);
      await humanPause([6000, 13000], {
        microPauseChance: 0.35,
        microPauseRange: [800, 2000],
        longPauseChance: 0.18,
        longPauseRange: [12000, 24000],
      });
    }

    await waitForVideos(batch.length, log, previousTopSignature);
    log(`🚀 Đã hoàn thành nhóm ${groupNumber}`);
    await humanPause([7000, 15000], {
      microPauseChance: 0.25,
      microPauseRange: [1000, 2500],
      longPauseChance: 0.12,
      longPauseRange: [15000, 30000],
    });
  }
}

async function runTextToImage(params, log) {
  const { aspectRatio, modelType, promptList, batchSize } = params;
  const renderCount = normalizeRenderCount(params.renderCount);
  await setupImagePage(aspectRatio, modelType, renderCount);
  blockEditNavigation();

  const effectiveBatchSize = resolveBatchSize(
    promptList.length,
    batchSize ?? 4,
  );
  for (let i = 0; i < promptList.length; i += effectiveBatchSize) {
    const batch = promptList.slice(i, i + effectiveBatchSize);
    const groupNumber = Math.floor(i / effectiveBatchSize) + 1;
    const tilesBefore = getImageTileCount();
    log(`📦 Đang xử lý nhóm ảnh ${groupNumber} (${batch.length} prompts)`);

    for (const prompt of batch) {
      const textbox = await waitFor('[role="textbox"]');
      await humanPause([1500, 3200], {
        microPauseChance: 0.3,
        microPauseRange: [500, 1200],
      });
      await humanType(textbox, prompt);
      await humanPause([1500, 3200], {
        microPauseChance: 0.3,
        microPauseRange: [500, 1200],
      });

      const createBtn =
        [...document.querySelectorAll("button")].find(
          (b) => b.querySelector("i")?.textContent?.trim() === "arrow_forward",
        ) ||
        [...document.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === "Tạo",
        );

      if (createBtn) await realClick(createBtn);
      log(`✅ Đã gửi prompt: ${prompt.substring(0, 30)}...`);
      await humanPause([6000, 13000], {
        microPauseChance: 0.35,
        microPauseRange: [800, 2000],
        longPauseChance: 0.18,
        longPauseRange: [12000, 24000],
      });
    }

    await waitForImages(batch.length, log, tilesBefore);
    log(`🚀 Đã hoàn thành nhóm ảnh ${groupNumber}`);
    await humanPause([7000, 15000], {
      microPauseChance: 0.25,
      microPauseRange: [1000, 2500],
      longPauseChance: 0.12,
      longPauseRange: [15000, 30000],
    });
  }
}

async function runIngredientsToVideo(params, log, serverUrl) {
  const { aspectRatio, modelType, ingredients } = params;
  const renderCount = normalizeRenderCount(params.renderCount);
  await setupPage(aspectRatio, modelType, "Thành phần", renderCount);
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
    await realClick(findPickerBtn());
    log(`Đã click picker Tạo`);
    await sleep(rnd(400, 700));

    // Đợi ô search xuất hiện rồi mới gõ
    const searchInput = await waitFor('input[placeholder*="Tìm kiếm"]', 10000);

    // Focus + clear, sau đó gõ bằng CDP để React nhận keyboard events và trigger filter
    searchInput.click();
    await sleep(200);
    setNativeInputValue(searchInput, name);
    await sleep(rnd(500, 900));

    // Đợi ảnh khớp tên xuất hiện sau khi filter
    await waitForCondition(
      () =>
        [...document.querySelectorAll("img")].some((img) => img.alt === name),
      15000,
    );
    const img = [...document.querySelectorAll("img")].find(
      (img) => img.alt === name,
    );
    if (!img) throw new Error(`Không tìm thấy ảnh: ${name}`);
    await realClick(img);
    log(`Đã chọn: ${name}`);
    await sleep(rnd(800, 1200));
  }

  for (let i = 0; i < ingredients.length; i++) {
    const item = ingredients[i];
    const previousTopSignature = getTileSignature(getTopVisibleIndexedItem());
    log(`🧪 Đang xử lý ingredient ${i + 1}/${ingredients.length}`);

    // Upload
    const fileInput = await waitFor('input[type="file"]', 30000);
    await uploadFromServer(serverUrl, item.imageNames, fileInput);
    await waitForUploadedImages(item.imageNames, 60000);
    log("✅ Upload ảnh xong");

    // Chọn từng ảnh vào slot ingredient
    for (const name of item.imageNames) {
      await selectImageForSlot(name);
    }

    // Type prompt
    const textbox = await waitFor('[role="textbox"]');
    await humanType(textbox, item.prompt);
    await humanPause([1500, 3200], {
      microPauseChance: 0.3,
      microPauseRange: [500, 1200],
    });

    // Submit: button có <i>arrow_forward</i>
    const submitBtn = [...document.querySelectorAll("button")].find(
      (b) => b.querySelector("i")?.textContent?.trim() === "arrow_forward",
    );
    if (!submitBtn)
      throw new Error("Không tìm thấy nút submit (arrow_forward)");

    await realClick(submitBtn);
    log(`✅ Đã gửi ingredient: ${item.prompt.substring(0, 30)}...`);

    await waitForVideos(1, log, previousTopSignature);
    log(`🚀 Xong item ${i + 1}`);
    await humanPause([6000, 13000], {
      microPauseChance: 0.35,
      microPauseRange: [800, 2000],
      longPauseChance: 0.18,
      longPauseRange: [12000, 24000],
    });
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
      else if (type === "text-to-image") await runTextToImage(params, log);
      else throw new Error(`Không biết task type: ${type}`);

      port.postMessage({ type: "done" });
    } catch (err) {
      console.error("Task error:", err);
      port.postMessage({ type: "error", error: err.message });
    }
  });
});

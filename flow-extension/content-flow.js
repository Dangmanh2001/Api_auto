// content-flow.js - chạy trên https://labs.google/fx/vi/tools/flow

const rnd = (min, max) => Math.floor(Math.random() * (max - min + 1) + min);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function keepPageActive() {
  try {
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    Object.defineProperty(document, "hidden", {
      configurable: true,
      get: () => false,
    });

    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function (type, ...args) {
      if (
        type === "visibilitychange" ||
        type === "freeze" ||
        type === "resume"
      ) {
        return undefined;
      }
      return originalAddEventListener.call(this, type, ...args);
    };
  } catch (err) {
    console.warn("keepPageActive failed:", err.message);
  }
}

keepPageActive();

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
  await sleep(rnd(500, 800)); // Đợi scroll hoàn tất
  const rect = el.getBoundingClientRect();
  // Click vào vị trí ngẫu nhiên trên nút thay vì chính giữa (giả lập người dùng thật)
  const cx = rect.left + rect.width * (0.3 + Math.random() * 0.4);
  const cy = rect.top + rect.height * (0.3 + Math.random() * 0.4);
  const opts = { bubbles: true, cancelable: true, clientX: cx, clientY: cy };

  el.dispatchEvent(new PointerEvent("pointerover", opts));
  el.dispatchEvent(new MouseEvent("mouseover", opts));
  el.dispatchEvent(new PointerEvent("pointerenter", opts));
  el.dispatchEvent(new MouseEvent("mouseenter", opts));

  await sleep(rnd(150, 300)); // Hover một chút trước khi nhấn

  el.dispatchEvent(new PointerEvent("pointerdown", opts));
  el.dispatchEvent(new MouseEvent("mousedown", { ...opts, button: 0 }));
  el.dispatchEvent(new PointerEvent("pointerup", opts));
  el.dispatchEvent(new MouseEvent("mouseup", { ...opts, button: 0 }));
  el.dispatchEvent(new MouseEvent("click", { ...opts, button: 0 }));
  await sleep(rnd(300, 600));
}

async function cdpClick(el) {
  if (!el) return;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  await sleep(500);
  const rect = el.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;

  await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { action: "cdp-click", tabId: _currentTabId, x, y },
      (res) => {
        if (res?.error) reject(new Error(res.error));
        else resolve();
      },
    );
  });
}

async function clickWithTrustedFallback(el) {
  if (!el) return;
  try {
    await cdpClick(el);
    return;
  } catch (err) {
    console.warn("cdpClick failed, fallback to realClick:", err.message);
  }
  await realClick(el);
}

function findRenderSubmitButton() {
  return [...document.querySelectorAll("button")].find((b) => {
    const icon = b.querySelector("i")?.textContent?.trim();
    const text = (b.textContent || "").trim();
    return (
      icon === "arrow_forward" &&
      /tạo|create|generate/i.test(text) &&
      b.getAttribute("aria-haspopup") !== "menu"
    );
  });
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

// Giả lập các hoạt động ngẫu nhiên của người dùng để tránh bị AI phát hiện
async function simulateHumanActivity() {
  // Cuộn chuột nhẹ lên xuống
  window.scrollBy({ top: rnd(-50, 50), behavior: "smooth" });
  await sleep(rnd(200, 500));

  // Di chuyển chuột ngẫu nhiên (chỉ dispatch event nếu cần, ở đây chủ yếu là delay)
  const x = rnd(100, window.innerWidth - 100);
  const y = rnd(100, window.innerHeight - 100);
  document.dispatchEvent(
    new MouseEvent("mousemove", { clientX: x, clientY: y, bubbles: true }),
  );
  await sleep(rnd(400, 1000));
}

function resolveBatchSize(total, preferred = 4) {
  if (!Number.isFinite(total) || total <= 0) return 1;
  const size = Number.parseInt(preferred, 10);
  if (!Number.isInteger(size) || size <= 0) return Math.min(4, total);
  return Math.min(size, total);
}

function getVisiblePromptText() {
  const boxes = [...document.querySelectorAll('[role="textbox"]')]
    .filter((el) => {
      const r = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return (
        r.width > 0 &&
        r.height > 0 &&
        r.bottom > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none" &&
        el.getAttribute("aria-hidden") !== "true"
      );
    })
    .sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);

  const el = boxes[0];
  return (el?.textContent || "").trim();
}

function normalizeTextForCompare(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function promptLooksApplied(expected) {
  const actual = normalizeTextForCompare(getVisiblePromptText());
  const target = normalizeTextForCompare(expected);
  if (!target) return actual.length > 0;
  if (!actual) return false;
  return actual.includes(target.slice(0, Math.min(target.length, 24)));
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

  await sleep(250);
  if (!promptLooksApplied(text)) {
    const el = document.querySelector('[role="textbox"]');
    if (el) {
      focusTextBox(el);
      try {
        document.execCommand("selectAll", false);
      } catch {}
      try {
        document.execCommand("insertText", false, text);
      } catch {
        el.textContent = text;
      }
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
    }
  }

  await humanPause([350, 900], {
    microPauseChance: 0.35,
    microPauseRange: [300, 900],
  });
}

// Tải file từ server qua background (tránh mixed content HTTPS→HTTP)
async function uploadFromServer(serverUrl, filenames, fileInput) {
  const dt = new DataTransfer();
  for (const name of filenames) {
    dt.items.add(await getServerFile(serverUrl, name));
  }
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
}

async function getServerFile(serverUrl, name) {
  const url = `${serverUrl}/uploads/${encodeURIComponent(name)}`;
  const result = await new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ action: "fetch-file", url }, (res) => {
      if (res?.error) reject(new Error(res.error));
      else resolve(res);
    });
  });
  const bytes = new Uint8Array(result.data);
  const blob = new Blob([bytes], { type: result.mime });
  return new File([blob], name, { type: result.mime });
}

async function getImageFileFromElement(img, name) {
  const src = img?.currentSrc || img?.src || img?.getAttribute("src") || "";
  if (!src) throw new Error("Không lấy được src ảnh vừa render");

  const response = await fetch(src);
  if (!response.ok) {
    throw new Error(`Không tải được ảnh vừa render: ${response.status}`);
  }

  const blob = await response.blob();
  return new File([blob], name, { type: blob.type || "image/png" });
}

function getLatestImageTile() {
  const topTile = getTopVisibleIndexedItem();
  if (topTile && isImageTileComplete(topTile)) {
    const img = topTile.querySelector("img");
    if (img) return { tile: topTile, img };
  }
  return null;
}

function isImageTileComplete(tile) {
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
  const img = tile.querySelector("img");
  return imageLooksReady(img);
}

function getImageTileCount() {
  return getIndexedItemCount();
}

async function uploadReferenceFiles(files) {
  const fileInput = await waitFor('input[type="file"]', 30000);
  const dt = new DataTransfer();
  files.forEach((file) => dt.items.add(file));
  fileInput.files = dt.files;
  fileInput.dispatchEvent(new Event("change", { bubbles: true }));
  await sleep(rnd(2000, 4000));
}

function findPickerBtn() {
  return [...document.querySelectorAll("button")].find(
    (b) =>
      [...b.querySelectorAll("span")].some(
        (s) => s.textContent?.trim() === "Tạo",
      ) && b.querySelector("i")?.textContent?.trim() !== "arrow_forward",
  );
}

async function selectImageFromPicker(name, log) {
  await waitForCondition(() => !!findPickerBtn(), 15000);
  await realClick(findPickerBtn());
  log(`Đã click picker Tạo`);
  await sleep(rnd(400, 700));

  const searchInput = await waitFor('input[placeholder*="Tìm kiếm"]', 10000);
  searchInput.click();
  await sleep(200);
  setNativeInputValue(searchInput, name);
  await sleep(rnd(500, 900));

  await waitForCondition(
    () =>
      [...document.querySelectorAll("img")].some((img) => {
        const alt = img.getAttribute("alt") || "";
        return alt === name || alt.includes(name);
      }),
    15000,
  );

  const img = [...document.querySelectorAll("img")].find((node) => {
    const alt = node.getAttribute("alt") || "";
    return alt === name || alt.includes(name);
  });

  if (!img) throw new Error(`Không tìm thấy ảnh trong picker: ${name}`);
  await realClick(img);
  log(`Đã chọn ảnh tham chiếu: ${name}`);
  await sleep(rnd(800, 1200));
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

function isRenderButtonReady() {
  const btn = findRenderSubmitButton();
  return (
    !!btn &&
    !btn.disabled &&
    btn.getAttribute("aria-disabled") !== "true"
  );
}

function isAnyGenerationInProgress() {
  if (
    document.querySelector(
      '[class*="generating"], [class*="spinner"], [aria-busy="true"]',
    )
  ) {
    return true;
  }

  return [...document.querySelectorAll("*")]
    .filter((el) => el.childElementCount === 0 && el.textContent)
    .some((el) => /^\d+%$/.test(el.textContent.trim()));
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

    // Chọn x1
    await waitForCondition(() => !!findButtonByText("1x"));
    await realClick(findButtonByText("1x"));
    await sleep(rnd(500, 1000));
    console.log(`✅ Đã chọn số lượng: ${renderCount}`);
  } catch (e) {
    console.log("Setup lỗi nhỏ, tiếp tục:", e.message);
  }

  console.log("✅ Setup Image xong, bắt đầu render...");
}

// ==================== WAIT FOR IMAGES ====================
async function waitForImages(
  _expectedCount,
  log,
  previousTopSignature = "",
  options = {},
) {
  const { allowComposerReadyFallback = false } = options;
  let stableCount = 0;
  const STABLE_NEEDED = 3;
  const TIMEOUT_MS = 10 * 60 * 1000;
  const startTime = Date.now();

  log("Chờ ảnh mới hoàn thành...");

  while (true) {
    await sleep(rnd(2500, 5000));

    if (Date.now() - startTime > TIMEOUT_MS) {
      log("⏰ Timeout 10 phút — bỏ qua");
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
      log(`⚠️ Phát hiện ${retryBtns.length} ảnh lỗi, đang Thử lại...`);
      await realClick(retryBtns[0]);
      await sleep(rnd(1500, 3000));
      continue;
    }

    const topTile = getTopVisibleIndexedItem();
    if (!topTile) {
      if (
        allowComposerReadyFallback &&
        isRenderButtonReady() &&
        !isAnyGenerationInProgress()
      ) {
        log("✅ Composer đã sẵn sàng cho prompt tiếp theo");
        break;
      }
      stableCount = 0;
      continue;
    }

    const currentTopSignature = getTileSignature(topTile);
    if (previousTopSignature && currentTopSignature === previousTopSignature) {
      stableCount = 0;
      continue;
    }

    if (!isImageTileComplete(topTile)) {
      stableCount = 0;
      continue;
    }

    if (
      allowComposerReadyFallback &&
      isRenderButtonReady() &&
      !isAnyGenerationInProgress()
    ) {
      log("✅ Render ảnh xong (composer ready)");
      break;
    }

    stableCount++;
    if (stableCount >= STABLE_NEEDED) {
      log("✅ Render ảnh xong!");
      break;
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

      await waitForCondition(() => getVisiblePromptText().length > 0, 5000);
      if (!getVisiblePromptText()) {
        log("⚠️ Prompt chưa vào ô nhập, gõ lại...");
        await humanType(textbox, prompt);
        await waitForCondition(() => getVisiblePromptText().length > 0, 5000);
      }

      await waitForCondition(() => {
        const btn = findRenderSubmitButton();
        return (
          btn &&
          !btn.disabled &&
          btn.getAttribute("aria-disabled") !== "true"
        );
      }, 15000);

      const createBtn = findRenderSubmitButton();
      if (!createBtn) throw new Error("Không tìm thấy nút Tạo (arrow_forward)");

      await clickWithTrustedFallback(createBtn);
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
    log(`📦 Đang xử lý nhóm ảnh ${groupNumber} (${batch.length} prompts)`);

    for (const prompt of batch) {
      const previousTopSignature = getTileSignature(getTopVisibleIndexedItem());
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

      await waitForCondition(() => {
        const btn = findRenderSubmitButton();
        return (
          btn &&
          !btn.disabled &&
          btn.getAttribute("aria-disabled") !== "true"
        );
      }, 15000);

      const createBtn = findRenderSubmitButton();
      if (!createBtn) throw new Error("Không tìm thấy nút Tạo (arrow_forward)");

      await clickWithTrustedFallback(createBtn);
      log(`✅ Đã gửi prompt: ${prompt.substring(0, 30)}...`);
      log("⏳ Chờ ảnh mới hoàn thành...");
      await waitForImages(1, log, previousTopSignature, {
        allowComposerReadyFallback: true,
      });
      log("🚀 Đã hoàn thành ảnh 1 prompt");

    }

    log(`🚀 Đã hoàn thành nhóm ảnh ${groupNumber}`);

  }
}

async function runTimeslapImage(params, log, serverUrl) {
  const { aspectRatio, modelType, initialImageName, imageCount, promptList } =
    params;
  const renderCount = "x1";

  if (!initialImageName) throw new Error("Thiếu ảnh 1 cho timeslap");
  if (!promptList || promptList.length === 0)
    throw new Error("Thiếu danh sách prompt timeslap");

  await setupImagePage(aspectRatio, modelType, renderCount);
  blockEditNavigation();

  const referenceFiles = [await getServerFile(serverUrl, initialImageName)];
  log(`🖼️ Đã nạp ảnh 1: ${initialImageName}`);

  for (let nextIndex = 2; nextIndex <= imageCount; nextIndex += 1) {
    const previousTopSignature = getTileSignature(getTopVisibleIndexedItem());

    // Logic chaining: Mỗi bước chỉ sử dụng duy nhất 1 ảnh vừa tạo ở bước trước đó làm tham chiếu
    const currentBatch = [referenceFiles[nextIndex - 2]];

    log(
      `📦 Render ảnh ${nextIndex}/${imageCount} với ${currentBatch.length} ảnh tham chiếu`,
    );

    await uploadReferenceFiles(currentBatch);
    await waitForUploadedImages(
      currentBatch.map((file) => file.name),
      60000,
    );

    for (const file of currentBatch) {
      await selectImageFromPicker(file.name, log);
    }

    await simulateHumanActivity();

    const textbox = await waitFor('[role="textbox"]');
    await humanPause([1000, 2200], {
      microPauseChance: 0.25,
      microPauseRange: [300, 900],
    });

    const stepPrompt = promptList[nextIndex - 2];
    await humanType(textbox, stepPrompt);

    // "Think time" - Giả lập người dùng kiểm tra lại prompt trước khi nhấn nút
    await humanPause([1200, 3000]);

    const createBtn =
      [...document.querySelectorAll("button")].find(
        (b) => b.querySelector("i")?.textContent?.trim() === "arrow_forward",
      ) ||
      [...document.querySelectorAll("button")].find(
        (b) => b.textContent?.trim() === "Tạo",
      );

    if (!createBtn) throw new Error("Không tìm thấy nút tạo ảnh");
    await realClick(createBtn);

    // Thêm một khoảng dừng nhỏ để đảm bảo DOM cập nhật hoàn toàn sau khi nhấn "Tạo"
    await humanPause([1000, 2000]);

    await waitForImages(1, log, previousTopSignature);

    const latest = getLatestImageTile();
    if (!latest?.img) {
      throw new Error(`Không lấy được ảnh ${nextIndex} sau khi render`);
    }

    const generatedFile = await getImageFileFromElement(
      latest.img,
      `timeslap-${nextIndex}.png`,
    );
    referenceFiles.push(generatedFile);
    log(
      `✅ Đã lấy ảnh ${nextIndex}, tổng ảnh tham chiếu: ${referenceFiles.length}`,
    );

    await humanPause([3000, 7000], {
      microPauseChance: 0.2,
      microPauseRange: [500, 1500],
    });
  }

  log(`🚀 Timeslap hoàn thành: ${referenceFiles.length}/${imageCount} ảnh`);
}

async function runIngredientsToVideo(params, log, serverUrl) {
  const { aspectRatio, modelType, ingredients } = params;
  const renderCount = normalizeRenderCount(params.renderCount);
  await setupPage(aspectRatio, modelType, "Thành phần", renderCount);
  blockEditNavigation();

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
      await selectImageFromPicker(name, log);
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

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "flow-ping") {
    sendResponse({ ok: true });
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "flow-task") return;

  port.onMessage.addListener(async (msg) => {
    if (msg.action !== "run") return;

    const { taskId, type, params, serverUrl, tabId } = msg;
    _currentTabId = tabId;

    const log = (text) => {
      console.log(text);
      chrome.runtime.sendMessage(
        {
          action: "proxy-request",
          url: `${serverUrl}/api/agent/log/${taskId}`,
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msg: text }),
        },
        () => {
          if (chrome.runtime.lastError) {
            /* Bỏ qua lỗi kết nối nếu extension chưa sẵn sàng */
          }
        },
      );
    };

    try {
      if (type === "text-to-video") await runTextToVideo(params, log);
      else if (type === "image-to-video")
        await runImageToVideo(params, log, serverUrl);
      else if (type === "ingredients-to-video")
        await runIngredientsToVideo(params, log, serverUrl);
      else if (type === "text-to-image") await runTextToImage(params, log);
      else if (type === "timeslap-image")
        await runTimeslapImage(params, log, serverUrl);
      else throw new Error(`Không biết task type: ${type}`);

      port.postMessage({ type: "done" });
    } catch (err) {
      console.error("Task error:", err);
      port.postMessage({ type: "error", error: err.message });
    }
  });
});

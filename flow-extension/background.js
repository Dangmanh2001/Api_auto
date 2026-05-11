const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const FLOW_URL = "https://labs.google/fx/vi/tools/flow";
const taskProgressStore = new Map();
let activeProxyConfig = null;
let proxyAuthRetryCount = 0;

function normalizeProxyConfig(raw = {}) {
  const host = String(raw.host || "").trim();
  const port = Number.parseInt(raw.port, 10);
  const username = String(raw.username || "").trim();
  const password = String(raw.password || "");
  if (!host || !Number.isInteger(port) || port <= 0) {
    throw new Error("Proxy config invalid: host/port");
  }
  return { host, port, username, password };
}

async function enableFixedProxy(raw = {}) {
  const cfg = normalizeProxyConfig(raw);
  await chrome.proxy.settings.set({
    value: {
      mode: "fixed_servers",
      rules: {
        singleProxy: {
          scheme: "http",
          host: cfg.host,
          port: cfg.port,
        },
        bypassList: ["localhost", "127.0.0.1"],
      },
    },
    scope: "regular",
  });
  activeProxyConfig = cfg;
  proxyAuthRetryCount = 0;
  return cfg;
}

chrome.webRequest.onAuthRequired.addListener(
  (details, callback) => {
    try {
      if (!details.isProxy || !activeProxyConfig) {
        callback({ cancel: false });
        return;
      }
      if (proxyAuthRetryCount > 5) {
        callback({ cancel: false });
        return;
      }
      proxyAuthRetryCount += 1;
      callback({
        authCredentials: {
          username: activeProxyConfig.username,
          password: activeProxyConfig.password,
        },
      });
    } catch {
      callback({ cancel: false });
    }
  },
  { urls: ["<all_urls>"] },
  ["asyncBlocking"],
);

function getProjectIdFromParams(params = {}) {
  if (params?.projectId) return String(params.projectId);

  const fromUrl = String(params?.projectUrl || params?.flowUrl || "");
  const match = fromUrl.match(/\/project\/([a-f0-9-]+)/i);
  return match?.[1] || "";
}

function buildFlowUrl(params = {}) {
  const projectId = getProjectIdFromParams(params);
  if (projectId) return `${FLOW_URL}/project/${projectId}`;
  return FLOW_URL;
}

function isRetryableThrottleError(err) {
  const msg = String(err?.message || err || "").toLowerCase();
  return (
    msg.includes("400") ||
    msg.includes("403") ||
    msg.includes("429") ||
    msg.includes("retry-exhausted-3") ||
    msg.includes("recaptcha") ||
    msg.includes("captcha") ||
    msg.includes("unusual traffic") ||
    msg.includes("restart requested")
  );
}

async function postAgentLog(serverUrl, taskId, text) {
  if (!serverUrl || !taskId) return;
  try {
    await fetch(`${serverUrl}/api/agent/log/${taskId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ msg: text }),
    });
  } catch {}
}

async function restartFlowSessionNow(params = {}) {
  await closeFlowTabs();
  await chrome.windows
    .create({ url: buildFlowUrl(params), focused: true })
    .catch(() => {});
}

function parseProxyEntry(entry) {
  if (!entry) return null;
  if (typeof entry === "object") {
    const host = String(entry.host || "").trim();
    const port = Number.parseInt(entry.port, 10);
    if (!host || !Number.isInteger(port) || port <= 0) return null;
    return {
      host,
      port,
      username: String(entry.username || "").trim(),
      password: String(entry.password || ""),
    };
  }
  const raw = String(entry).trim();
  if (!raw) return null;
  const parts = raw.split(":");
  if (parts.length < 4) return null;
  const [host, portRaw, username, password] = parts;
  const port = Number.parseInt(portRaw, 10);
  if (!host || !Number.isInteger(port) || port <= 0) return null;
  return { host, port, username: username || "", password: password || "" };
}

function getProxyCandidates(params = {}) {
  const fromList = Array.isArray(params.proxyList) ? params.proxyList : [];
  const parsedList = fromList.map(parseProxyEntry).filter(Boolean);
  if (parsedList.length > 0) return parsedList;

  const single = parseProxyEntry(params.proxy);
  if (single) return [single];

  return [parseProxyEntry("118.70.187.200:31722:pWnBpE:tXPhqp")].filter(Boolean);
}

async function captureLatestProjectIdFromOpenTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://labs.google/*"] });
  const flowTabs = tabs.filter((t) => (t.url || "").includes("/fx/vi/tools/flow/project/"));
  if (flowTabs.length === 0) return "";
  const latest = flowTabs[flowTabs.length - 1];
  const match = String(latest.url || "").match(/\/project\/([a-f0-9-]+)/i);
  return match?.[1] || "";
}

// ==================== AGENT ID ====================
async function getAgentId() {
  const result = await chrome.storage.local.get("agentId");
  if (result.agentId) return result.agentId;
  const id = "ext-" + Math.random().toString(36).slice(2, 10);
  await chrome.storage.local.set({ agentId: id });
  return id;
}

// ==================== CDP TYPING (như Puppeteer) ====================
const attachedTabs = new Set();

async function attachDebugger(tabId) {
  if (attachedTabs.has(tabId)) return;
  await chrome.debugger.attach({ tabId }, "1.3");
  attachedTabs.add(tabId);
}

async function keepTabActive(tabId) {
  await attachDebugger(tabId);

  await chrome.debugger
    .sendCommand({ tabId }, "Emulation.setFocusEmulationEnabled", {
      enabled: true,
    })
    .catch(() => {});

  await chrome.debugger
    .sendCommand({ tabId }, "Page.setWebLifecycleState", {
      state: "active",
    })
    .catch(() => {});
}

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  await chrome.debugger.detach({ tabId }).catch(() => {});
  attachedTabs.delete(tabId);
}

// Gõ text qua CDP Input.insertText — giống Puppeteer page.keyboard.type()
// Input.insertText đi qua native input pipeline của Chrome → React nhận đúng onChange
async function cdpTypeText(tabId, text) {
  await attachDebugger(tabId);

  const locateScript = `
    (() => {
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
      if (!el) return { ok: false, reason: "textbox-not-found" };
      const r = el.getBoundingClientRect();
      return {
        ok: true,
        x: Math.floor(r.left + r.width / 2),
        y: Math.floor(r.top + Math.min(r.height / 2, 24)),
      };
    })();
  `;

  const locateResult = await chrome.debugger.sendCommand(
    { tabId },
    "Runtime.evaluate",
    {
      expression: locateScript,
      returnByValue: true,
      awaitPromise: false,
    },
  );

  const value = locateResult?.result?.value || {};
  if (!value.ok) {
    throw new Error(`cdp-type failed: ${value.reason || "unknown"}`);
  }

  const x = Number(value.x);
  const y = Number(value.y);

  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    clickCount: 0,
  });
  await sleep(40);
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await sleep(60);

  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    modifiers: 2,
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    modifiers: 2,
    key: "a",
    code: "KeyA",
    windowsVirtualKeyCode: 65,
  });
  await sleep(40);

  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyDown",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
  });
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchKeyEvent", {
    type: "keyUp",
    key: "Backspace",
    code: "Backspace",
    windowsVirtualKeyCode: 8,
  });
  await sleep(40);

  await chrome.debugger.sendCommand({ tabId }, "Input.insertText", {
    text: String(text ?? ""),
  });

  console.log("CDP insertText done:", text.substring(0, 40));
}

async function cdpClickAt(tabId, x, y) {
  await attachDebugger(tabId);
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x,
    y,
    button: "none",
    clickCount: 0,
  });
  await sleep(60);
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
  await sleep(40);
  await chrome.debugger.sendCommand({ tabId }, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x,
    y,
    button: "left",
    clickCount: 1,
  });
}

// ==================== MESSAGES ====================
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "get-agent-id") {
    getAgentId().then((id) => sendResponse({ agentId: id }));
    return true;
  }

  if (msg.action === "cdp-type") {
    cdpTypeText(msg.tabId, msg.text)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "cdp-click") {
    cdpClickAt(msg.tabId, msg.x, msg.y)
      .then(() => sendResponse({ ok: true }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "fetch-file") {
    fetch(msg.url)
      .then((r) => r.arrayBuffer())
      .then((buf) =>
        sendResponse({
          ok: true,
          data: Array.from(new Uint8Array(buf)),
          mime: msg.mime || "image/jpeg",
        }),
      )
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "proxy-request") {
    const { url, method, headers, body } = msg;
    fetch(url, {
      method: method || "GET",
      headers: headers || {},
      body: body,
    })
      .then(async (r) => {
        const data = await r.text();
        sendResponse({ ok: r.ok, data });
      })
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "run-task") {
    runTaskWithRestart(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "enable-proxy") {
    enableFixedProxy(msg.proxy || {})
      .then((cfg) => sendResponse({ ok: true, host: cfg.host, port: cfg.port }))
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (msg.action === "task-progress") {
    const { taskId, phase, state, index, total } = msg;
    if (taskId && phase === "text-to-image" && Number.isInteger(index)) {
      const current = taskProgressStore.get(taskId) || {
        completedIndex: -1,
        startedIndex: -1,
        nextIndex: 0,
        total: Number.isInteger(total) ? total : 0,
      };
      if (state === "started") {
        current.startedIndex = index;
      } else if (state === "completed") {
        current.completedIndex = Math.max(current.completedIndex, index);
        current.nextIndex = current.completedIndex + 1;
      }
      if (Number.isInteger(total) && total > 0) current.total = total;
      taskProgressStore.set(taskId, current);
    }
    sendResponse({ ok: true });
    return true;
  }

  if (msg.action === "restart-flow-session") {
    // Do not restart immediately from content script.
    // Let runTaskWithRestart coordinate restart + resume to avoid broken port flow.
    sendResponse({ ok: true });
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "agent-runner") return;

  port.onMessage.addListener((msg) => {
    if (msg.action !== "run-task") return;

    runTaskWithRestart(msg)
      .then(() => port.postMessage({ ok: true }))
      .catch((err) => port.postMessage({ error: err.message }));
  });
});

// Cleanup debugger khi tab đóng
chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
});

// ==================== RUN TASK ====================
async function runTask({ taskId, type, params, serverUrl }) {
  const resolvedServerUrl = (serverUrl || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const tab = await chrome.tabs.create({
    url: buildFlowUrl(params),
    active: true,
  });

  await waitForTabReady(tab.id);
  await ensureFlowContentScript(tab.id);

  // Attach debugger sớm để tab không bị Chrome throttle khi ở background
  await keepTabActive(tab.id);

  return new Promise((resolve, reject) => {
    const port = chrome.tabs.connect(tab.id, { name: "flow-task" });
    let settled = false;

    port.onMessage.addListener(async (msg) => {
      if (msg.type === "done") {
        settled = true;
        await detachDebugger(tab.id);
        port.disconnect();
        resolve({ ok: true });
      }
      if (msg.type === "error") {
        settled = true;
        await detachDebugger(tab.id);
        port.disconnect();
        reject(new Error(msg.error));
      }
    });

    port.onDisconnect.addListener(() => {
      detachDebugger(tab.id);
      if (!settled) reject(new Error("Port disconnected"));
    });

    // Truyền cả tabId để content script gọi cdp-type
    port.postMessage({
      action: "run",
      taskId,
      type,
      params,
      serverUrl: resolvedServerUrl,
      tabId: tab.id,
    });
  });
}

async function closeFlowTabs() {
  const tabs = await chrome.tabs.query({ url: ["https://labs.google/*"] });
  const flowTabIds = tabs
    .filter((t) => (t.url || "").includes("/fx/vi/tools/flow"))
    .map((t) => t.id)
    .filter((id) => Number.isInteger(id));

  for (const id of flowTabIds) {
    await detachDebugger(id).catch(() => {});
  }

  if (flowTabIds.length > 0) {
    await chrome.tabs.remove(flowTabIds).catch(() => {});
  }
}

async function runTaskWithRestart(payload) {
  const resolvedServerUrl = (payload.serverUrl || "http://localhost:3000").replace(
    /\/$/,
    "",
  );
  const maxRestarts = Math.max(
    1,
    Number.parseInt(payload?.params?.maxSessionRestarts ?? 12, 10) || 12,
  );
  const proxyCandidates = getProxyCandidates(payload?.params || {});
  let proxyCursor = -1;
  let reloadDoneAfterRetryExhausted = false;
  let lastError = null;

  for (let attempt = 1; attempt <= maxRestarts + 1; attempt += 1) {
    try {
      if (!payload.params) payload.params = {};
      const progress = taskProgressStore.get(payload.taskId);
      if (
        payload.type === "text-to-image" &&
        progress &&
        Number.isInteger(progress.nextIndex) &&
        progress.nextIndex > 0
      ) {
        payload.params.resumeFromIndex = progress.nextIndex;
      }

      if (attempt > 1) {
        const resumeAt = Number.isInteger(payload.params.resumeFromIndex)
          ? payload.params.resumeFromIndex + 1
          : 1;
        await postAgentLog(
          resolvedServerUrl,
          payload.taskId,
          `Auto resume after restart: attempt ${attempt}/${maxRestarts + 1}, resume at prompt ${resumeAt}`,
        );
      }
      const result = await runTask(payload);
      taskProgressStore.delete(payload.taskId);
      return result;
    } catch (err) {
      lastError = err;
      if (!isRetryableThrottleError(err)) throw err;
      if (attempt > maxRestarts) break;

      const msg = String(err?.message || err || "").toLowerCase();
      if (!payload.params) payload.params = {};
      const latestProjectId = await captureLatestProjectIdFromOpenTabs().catch(() => "");
      if (latestProjectId) payload.params.projectId = latestProjectId;

      if (msg.includes("retry-exhausted-3")) {
        if (!reloadDoneAfterRetryExhausted) {
          reloadDoneAfterRetryExhausted = true;
          await postAgentLog(
            resolvedServerUrl,
            payload.taskId,
            `Retry quá 3 lần. Reload lại đúng project hiện tại và resume prompt lỗi (${attempt}/${maxRestarts}).`,
          );
          await restartFlowSessionNow(payload.params || {});
          await sleep(5000);
          continue;
        }

        if (proxyCandidates.length > 0) {
          proxyCursor = (proxyCursor + 1) % proxyCandidates.length;
          const nextProxy = proxyCandidates[proxyCursor];
          await enableFixedProxy(nextProxy);
          await postAgentLog(
            resolvedServerUrl,
            payload.taskId,
            `Sau reload vẫn lỗi. Đổi proxy ${proxyCursor + 1}/${proxyCandidates.length}: ${nextProxy.host}:${nextProxy.port}`,
          );
        } else {
          await postAgentLog(
            resolvedServerUrl,
            payload.taskId,
            "Sau reload vẫn lỗi nhưng không có proxy hợp lệ để xoay vòng.",
          );
        }
        await restartFlowSessionNow(payload.params || {});
        await sleep(7000);
        continue;
      }

      await postAgentLog(
        resolvedServerUrl,
        payload.taskId,
        `Detected 400/403/429/captcha. Restart browser session and auto-continue (${attempt}/${maxRestarts}).`,
      );
      await restartFlowSessionNow(payload.params || {});
      const restartBackoffMs = Math.min(180000, 15000 * attempt);
      await sleep(restartBackoffMs);
    }
  }

  throw new Error(
    `Restarted ${maxRestarts} times but still hit 400/403/429/captcha. Last error: ${lastError?.message || "unknown"}`,
  );
}

async function ensureFlowContentScript(tabId, timeout = 120000) {
  const start = Date.now();
  let injected = false;

  while (Date.now() - start < timeout) {
    const tab = await chrome.tabs.get(tabId);
    const url = tab.url || "";

    if (!url.startsWith("https://labs.google/fx/vi/tools/flow")) {
      await sleep(1000);
      continue;
    }

    const pong = await chrome.tabs
      .sendMessage(tabId, { action: "flow-ping" })
      .catch(() => null);

    if (pong?.ok) return;

    if (!injected) {
      await chrome.scripting
        .executeScript({
          target: { tabId },
          files: ["content-flow.js"],
        })
        .catch(() => {});
      injected = true;
    }

    await sleep(1000);
  }

  throw new Error(
    "Flow content script is not ready. Check login/page URL and reload the extension.",
  );
}

async function waitForTabReady(tabId, timeout = 60000) {
  await new Promise((resolve, reject) => {
    const listener = (id, info) => {
      if (id === tabId && info.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeout);
  });
  await sleep(1200);
}

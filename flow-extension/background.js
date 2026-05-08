const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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
    runTask(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== "agent-runner") return;

  port.onMessage.addListener((msg) => {
    if (msg.action !== "run-task") return;

    runTask(msg)
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
    url: "https://labs.google/fx/vi/tools/flow",
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

const SERVER = "http://localhost:3000";
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

async function detachDebugger(tabId) {
  if (!attachedTabs.has(tabId)) return;
  await chrome.debugger.detach({ tabId }).catch(() => {});
  attachedTabs.delete(tabId);
}

// Gõ text qua CDP Input.insertText — giống Puppeteer page.keyboard.type()
// Input.insertText đi qua native input pipeline của Chrome → React nhận đúng onChange
async function cdpTypeText(tabId, text) {
  await attachDebugger(tabId);

  // 1. Focus textbox trong main world
  await chrome.debugger.sendCommand({ tabId }, "Runtime.evaluate", {
    expression: `
      const el = document.querySelector('[role="textbox"]');
      if (el) { el.focus(); el.click(); }
    `,
    awaitPromise: false,
  });
  await sleep(300);

  // 2. Ctrl+A để select all
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
  await sleep(80);

  // 3. Backspace để xóa
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
  await sleep(100);

  // 4. Gõ text — Input.insertText trigger input event đúng cách như Puppeteer
  await chrome.debugger.sendCommand({ tabId }, "Input.insertText", { text });

  console.log("CDP insertText done:", text.substring(0, 40));
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

  if (msg.action === "run-task") {
    runTask(msg)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }
});

// Cleanup debugger khi tab đóng
chrome.tabs.onRemoved.addListener((tabId) => {
  detachDebugger(tabId);
});

// ==================== RUN TASK ====================
async function runTask({ taskId, type, params }) {
  const tab = await chrome.tabs.create({
    url: "https://labs.google/fx/vi/tools/flow",
    active: false,
  });

  await waitForTabReady(tab.id);

  // Attach debugger sớm để tab không bị Chrome throttle khi ở background
  await attachDebugger(tab.id);

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
      serverUrl: SERVER,
      tabId: tab.id,
    });
  });
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

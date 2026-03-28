// content-web.js - chạy trên giao diện 192.168.1.89:3000
const SERVER = location.origin;
let agentId = null;
let isBusy = false;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Lấy agentId từ background
chrome.runtime.sendMessage({ action: "get-agent-id" }, (res) => {
  agentId = res?.agentId || "unknown";
  showBadge("green", `✅ Agent: ${agentId}`);
  injectAgentId();
  startPolling();
});

function showBadge(color, text) {
  let badge = document.getElementById("flow-agent-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "flow-agent-badge";
    badge.style.cssText =
      "position:fixed;bottom:16px;right:16px;padding:8px 14px;" +
      "border-radius:8px;font-size:13px;font-weight:600;z-index:9999;" +
      "box-shadow:0 2px 8px rgba(0,0,0,.25);transition:background .3s;";
    document.body.appendChild(badge);
  }
  badge.style.background = color === "green" ? "#22c55e" : color === "yellow" ? "#f59e0b" : "#ef4444";
  badge.style.color = "#fff";
  badge.textContent = text;
}

function injectAgentId() {
  document.querySelectorAll("form").forEach((form) => {
    let input = form.querySelector('input[name="agentId"]');
    if (!input) {
      input = document.createElement("input");
      input.type = "hidden";
      input.name = "agentId";
      form.appendChild(input);
    }
    input.value = agentId;
  });
}

// Quan sát DOM thay đổi để inject agentId vào form mới
const observer = new MutationObserver(() => injectAgentId());
observer.observe(document.body, { childList: true, subtree: true });

async function startPolling() {
  while (true) {
    await sleep(3000);
    if (isBusy || !agentId) continue;

    try {
      const res = await fetch(
        `${SERVER}/api/agent/poll?agent=${encodeURIComponent(agentId)}`
      );
      const data = await res.json();
      if (!data.task) continue;

      isBusy = true;
      const { id, type, params } = data.task;

      showBadge("yellow", `⏳ Đang chạy task #${id}...`);

      const postLog = (msg) =>
        fetch(`${SERVER}/api/agent/log/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ msg }),
        }).catch(() => {});

      try {
        await postLog(`🤖 [${agentId}] Nhận task #${id}: ${type}`);

        await new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: "run-task", taskId: id, type, params },
            (res) => {
              if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
              } else if (res?.error) {
                reject(new Error(res.error));
              } else {
                resolve();
              }
            }
          );
        });

        await fetch(`${SERVER}/api/agent/finish/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "done" }),
        });
        await postLog("✅ Task hoàn thành!");
        showBadge("green", `✅ Agent: ${agentId}`);
      } catch (err) {
        await fetch(`${SERVER}/api/agent/finish/${id}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: "failed", error: err.message }),
        }).catch(() => {});
        await postLog(`❌ Thất bại: ${err.message}`);
        showBadge("green", `✅ Agent: ${agentId}`);
      } finally {
        isBusy = false;
      }
    } catch (err) {
      // Server chưa bật hoặc mất kết nối — im lặng
    }
  }
}

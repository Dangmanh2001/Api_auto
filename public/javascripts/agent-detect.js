(async () => {
  // Ngăn chạy chồng chéo nếu script được gọi lại nhanh trong SPA
  if (window._isDetectingAgent) return;
  window._isDetectingAgent = true;

  let badge = document.getElementById("agent-status-badge");
  if (!badge) {
    badge = document.createElement("div");
    badge.id = "agent-status-badge";
    document.body.appendChild(badge);
  }

  badge.style.cssText =
    "position:fixed;bottom:16px;right:16px;padding:8px 14px;border-radius:8px;" +
    "font-size:13px;font-weight:600;z-index:9999;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.2);";

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 1500);
    const res = await fetch("http://localhost:3001", {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    const { agentId } = await res.json();

    // Gắn agentId vào tất cả form trên trang
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

    badge.style.background = "#22c55e";
    badge.style.color = "#fff";
    badge.textContent = `✅ Agent: ${agentId}`;
  } catch {
    badge.style.background = "#ef4444";
    badge.style.color = "#fff";
    badge.textContent = "⚠️ Agent chưa chạy — click để xem hướng dẫn";
    badge.onclick = () =>
      alert(
        "Automation sẽ chạy trên máy CHỦ vì agent chưa được khởi động.\n\n" +
          "Để chạy trên MÁY NÀY:\n" +
          "1. Cài Node.js\n" +
          "2. Copy thư mục app về máy này\n" +
          "3. Chạy: node agent.js http://SERVER_IP:3000",
      );
  }
})();

// SPA navigation helper for My-app
// Intercept internal links and load content via AJAX to avoid full page reload.

let spaCleanupTasks = [];
let activeEventSources = [];
let activeAbortController = null;

window.registerSpaCleanup = (cleanupFn) => {
  if (typeof cleanupFn === "function") {
    spaCleanupTasks.push(cleanupFn);
  }
};

// Helper mới để quản lý EventSource trong SPA
window.registerEventSource = (url) => {
  const es = new EventSource(url);
  activeEventSources.push(es);
  console.log(`[SPA] Registered SSE: ${url}`);
  return es;
};

function cleanupSpaPage() {
  spaCleanupTasks.forEach((fn) => {
    try {
      fn();
    } catch (error) {
      console.error("Error during SPA cleanup:", error);
    }
  });
  spaCleanupTasks = [];

  // Đóng tất cả kết nối SSE cũ để giải phóng connection pool
  activeEventSources.forEach((es) => es.close());
  activeEventSources = [];
  console.log("[SPA] All SSE connections closed");
}

function parseHTML(html) {
  return new DOMParser().parseFromString(html, "text/html");
}

function runEmbeddedScripts(container) {
  const scripts = Array.from(container.querySelectorAll("script"));
  scripts.forEach((oldScript) => {
    const script = document.createElement("script");
    if (oldScript.src) {
      script.src = oldScript.src;
      script.async = false;
    } else {
      script.textContent = oldScript.textContent;
    }
    oldScript.parentNode?.replaceChild(script, oldScript);
  });
}

async function spaLoadPage(url, pushState = true) {
  // Hủy request đang chạy nếu có để tránh lag khi nhấn liên tục
  if (activeAbortController) {
    activeAbortController.abort();
  }
  activeAbortController = new AbortController();

  // Clean up the previous page (intervals/SSE etc.) to avoid leaks and lag
  cleanupSpaPage();

  const root = document.getElementById("page-root");
  if (root) root.style.opacity = "0.6"; // Hiệu ứng phản hồi thị giác

  try {
    const response = await fetch(url, {
      signal: activeAbortController.signal,
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest" },
    });

    if (!response.ok) {
      window.location.href = url;
      return;
    }

    const html = await response.text();
    const doc = parseHTML(html);
    const newRoot = doc.getElementById("page-root");
    if (!newRoot) {
      window.location.href = url;
      return;
    }

    if (!root) {
      window.location.href = url;
      return;
    }

    root.innerHTML = newRoot.innerHTML;
    root.style.opacity = "1";
    document.title = doc.title || document.title;
    runEmbeddedScripts(root);
    window.scrollTo(0, 0); // Quay lại đầu trang

    if (pushState) {
      window.history.pushState(null, "", url);
    }
  } catch (error) {
    if (error.name === "AbortError") return; // Bỏ qua nếu là lỗi do chủ động hủy
    console.error("SPA load failed", error);
    window.location.href = url;
    if (root) root.style.opacity = "1";
  }
}

function spaLinkHandler(event) {
  const anchor = event.target.closest("a");
  if (!anchor) return;

  const href = anchor.getAttribute("href");
  if (
    !href ||
    href.startsWith("#") ||
    href.startsWith("mailto:") ||
    href.startsWith("tel:")
  )
    return;
  if (anchor.target === "_blank" || anchor.hasAttribute("download")) return;

  const url = new URL(href, window.location.origin);
  if (url.origin !== window.location.origin) return;

  event.preventDefault();

  if (url.pathname === window.location.pathname) {
    return;
  }

  spaLoadPage(href); // Dùng href thay vì pathname để giữ query params (?...)
}

window.addEventListener("popstate", () => {
  spaLoadPage(window.location.href, false);
});

document.addEventListener("click", spaLinkHandler);

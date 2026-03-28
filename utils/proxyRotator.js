const http = require("http");
const net = require("net");
const { EventEmitter } = require("events");

const LOCAL_PROXY_PORT = 18888;
const proxyEvents = new EventEmitter();

// Proxy hiện tại đang được dùng (thay đổi mà không cần restart browser)
let currentProxy = null; // { host, port, username, password }

// Đếm lỗi liên tiếp của proxy hiện tại
let errorCount = 0;
const MAX_ERRORS = 3; // sau 3 lỗi ECONNRESET → tự switch proxy

// Đổi proxy ngay lập tức — browser không cần restart
function setCurrentProxy({ host, port, username, password }) {
  currentProxy = { host, port, username, password };
  errorCount = 0; // reset bộ đếm lỗi khi đổi proxy mới
  console.log(`🔄 Đã đổi upstream proxy: ${host}:${port}`);
}

function onUpstreamError(err) {
  console.error(`❌ Upstream proxy error: ${err.message}`);
  errorCount++;
  if (errorCount >= MAX_ERRORS) {
    console.warn(
      `⚠️ Proxy lỗi ${errorCount} lần liên tiếp → yêu cầu đổi proxy...`,
    );
    errorCount = 0;
    proxyEvents.emit("rotate");
  }
}

// Tạo local proxy server (chỉ gọi 1 lần khi app start)
function startProxyRotator() {
  // Xử lý HTTP thông thường — forward tới upstream proxy
  const server = http.createServer((req, res) => {
    if (!currentProxy) {
      res.writeHead(503);
      res.end("No proxy configured");
      return;
    }
    const { host, port, username, password } = currentProxy;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");
    const options = {
      host,
      port: parseInt(port),
      method: req.method,
      path: req.url,
      headers: {
        ...req.headers,
        "Proxy-Authorization": `Basic ${auth}`,
      },
    };
    const proxyReq = http.request(options, (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    });
    proxyReq.on("error", (err) => {
      onUpstreamError(err);
      res.writeHead(502);
      res.end("Bad Gateway");
    });
    req.pipe(proxyReq);
  });

  // Xử lý HTTPS tunnel (CONNECT)
  server.on("connect", (req, clientSocket, head) => {
    if (!currentProxy) {
      clientSocket.write("HTTP/1.1 503 No proxy configured\r\n\r\n");
      clientSocket.destroy();
      return;
    }

    const { host, port, username, password } = currentProxy;
    const auth = Buffer.from(`${username}:${password}`).toString("base64");

    const upstreamSocket = net.connect(parseInt(port), host, () => {
      upstreamSocket.write(
        `CONNECT ${req.url} HTTP/1.1\r\n` +
          `Host: ${req.url}\r\n` +
          `Proxy-Authorization: Basic ${auth}\r\n` +
          `\r\n`,
      );

      // Gom nhiều chunk cho đến khi thấy header đầy đủ
      let buffer = "";
      const onData = (chunk) => {
        buffer += chunk.toString();
        if (!buffer.includes("\r\n\r\n")) return; // chưa đủ header
        upstreamSocket.removeListener("data", onData);

        if (buffer.includes("200")) {
          clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
          if (head && head.length) upstreamSocket.write(head);
          upstreamSocket.pipe(clientSocket);
          clientSocket.pipe(upstreamSocket);
        } else {
          console.error(
            "❌ Upstream CONNECT thất bại:",
            buffer.split("\r\n")[0],
          );
          clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
          clientSocket.destroy();
          upstreamSocket.destroy();
        }
      };
      upstreamSocket.on("data", onData);
    });

    upstreamSocket.on("error", (err) => {
      onUpstreamError(err);
      clientSocket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
      clientSocket.destroy();
    });

    clientSocket.on("error", () => upstreamSocket.destroy());
  });

  server.listen(LOCAL_PROXY_PORT, "127.0.0.1", () => {
    console.log(
      `🌐 Local proxy rotator đang chạy tại 127.0.0.1:${LOCAL_PROXY_PORT}`,
    );
  });

  return server;
}

module.exports = {
  startProxyRotator,
  setCurrentProxy,
  LOCAL_PROXY_PORT,
  proxyEvents,
};

# Luồng Hoạt Động Dự Án — API Tool + Flow Agent

## Tổng Quan

Dự án là một web app (Express.js) cho phép người dùng tạo video tự động trên **Google Flow** (`labs.google/fx/vi/tools/flow`) thông qua một Chrome extension chạy trên máy khách.

```
[Người dùng] → [Web UI :3000] → [TaskQueue] → [Extension] → [Google Flow]
```

---

## Kiến Trúc Hệ Thống

```
my-app/
├── app.js                  # Entry point Express
├── routes/api.js           # Toàn bộ API routes + Agent Manager
├── controllers/            # Logic xử lý từng loại task
│   ├── TextToVideo.controllers.js
│   ├── ImageToVideo.controller.js
│   └── IngredientsToVideo.js
├── utils/taskQueue.js      # Hàng đợi task trong bộ nhớ
├── views/                  # Giao diện EJS
│   ├── index.ejs           # Trang chủ + Agent Control Panel
│   ├── TextToVideo.ejs
│   ├── ImageToVideo.ejs
│   ├── IngredientsToVideo.ejs
│   └── gemini.ejs
├── flow-extension/         # Chrome Extension chạy trên máy khách
│   ├── manifest.json
│   ├── background.js       # Service worker: CDP typing, mở tab Flow
│   ├── content-web.js      # Chạy trên localhost:3000 — polling task
│   └── content-flow.js     # Chạy trên labs.google/flow — thực thi auto
└── uploads/                # Ảnh upload từ người dùng (tự xóa sau 2 ngày)
```

---

## Luồng Chi Tiết — Từng Bước

### BƯỚC 1 — Khởi Động Agent (từ trang chủ)

```
Người dùng mở http://localhost:3000
  → Nhập đường dẫn Chrome Profile (VD: C:\Users\...\Profile 51)
  → Nhấn nút "Start"
  → POST /api/agent/start { profilePath }
  → Server gọi startAgent()
      → Tìm chrome.exe trên máy
      → spawn Chrome với:
          --load-extension=<đường dẫn flow-extension/>
          --user-data-dir=<profile>
          http://localhost:3000   ← mở sẵn trang này
  → Chrome mở, extension load vào
```

### BƯỚC 2 — Extension Kết Nối (content-web.js)

```
Chrome mở localhost:3000
  → content-web.js tự động chạy (content_scripts trong manifest)
  → Gửi message đến background.js: { action: "get-agent-id" }
  → background.js trả về agentId (lưu trong chrome.storage)
  → content-web.js:
      ① Hiện badge xanh góc màn hình: "✅ Agent: <id>"
      ② Inject hidden input[name="agentId"] vào mọi form trên trang
      ③ Bắt đầu vòng poll mỗi 3 giây → GET /api/agent/poll?agent=<id>
```

> **Lưu ý:** Server hiện có endpoint SSE `/api/agent/stream` cho agent kết nối
> nhận task real-time — đây là hướng phát triển mới hơn.
> `content-web.js` hiện dùng polling, hai cơ chế này song song tồn tại.

### BƯỚC 3 — Người Dùng Gửi Task

```
Người dùng điền form (TextToVideo / ImageToVideo / IngredientsToVideo)
  → Form đã có hidden field agentId (do extension inject ở bước 2)
  → Nhấn Submit → POST /api hoặc /api/imageToVideo v.v.
  → Controller nhận request:
      ① Parse dữ liệu (prompts, aspectRatio, modelType, files...)
      ② Lưu file ảnh vào uploads/ (nếu có)
      ③ Gọi taskQueue.create(type, params, agentId)
```

### BƯỚC 4 — TaskQueue Phân Phối Task

```
taskQueue.create() tạo task object:
  {
    id: <số tăng dần>,
    type: "text-to-video" | "image-to-video" | "ingredients-to-video",
    params: { aspectRatio, modelType, promptList/tasks/ingredients },
    targetAgent: <agentId hoặc null>,
    status: "pending",
    logs: [],
    createdAt: ...
  }

taskQueue.emit("created", task)
  → api.js lắng nghe sự kiện này
  → tryDispatchTask(agentId): push task qua SSE đến agent đang kết nối
```

### BƯỚC 5 — Extension Nhận Task (content-web.js)

```
content-web.js poll thấy task mới từ server
  → isBusy = true
  → Hiện badge vàng: "⏳ Đang chạy task #..."
  → Gửi message đến background.js:
      { action: "run-task", taskId, type, params }
```

### BƯỚC 6 — Background.js Mở Tab Google Flow

```
background.js nhận { action: "run-task" }
  → chrome.tabs.create({ url: "https://labs.google/fx/vi/tools/flow", active: false })
  → Chờ tab load xong (waitForTabReady)
  → Attach CDP Debugger vào tab (để gõ text như Puppeteer)
  → Mở Port kết nối đến content-flow.js:
      chrome.tabs.connect(tabId, { name: "flow-task" })
  → Gửi lệnh qua port:
      { action: "run", taskId, type, params, serverUrl, tabId }
```

### BƯỚC 7 — Content-flow.js Thực Thi Automation

```
content-flow.js đang chạy trên tab Google Flow
  → Lắng nghe chrome.runtime.onConnect (port "flow-task")
  → Nhận lệnh run → gọi đúng hàm theo type:

  ┌─ "text-to-video"       → runTextToVideo()
  ├─ "image-to-video"      → runImageToVideo()
  └─ "ingredients-to-video" → runIngredientsToVideo()
```

#### Chi tiết từng hàm:

**setupPage()** — chạy đầu tiên, dùng chung cho cả 3 loại:
```
1. Chờ trang login xong (nếu chưa login)
2. Click "Dự án mới"
3. Mở menu → chọn tab Video
4. Chọn mode: "Khung hình" (Frame) hoặc "Thành phần" (Ingredients)
5. Chọn tỉ lệ khung hình (16:9 / 9:16)
6. Chọn Model từ dropdown (Veo 3.1 - Fast / Lite / Creative...)
7. Chọn x1
```

**runTextToVideo()**:
```
Chia prompts thành batch 3~5 prompt
  → Với mỗi prompt:
      ① Tìm [role="textbox"]
      ② humanType() → gửi message cdp-type đến background.js
          → background.js dùng CDP Input.insertText gõ vào Flow
      ③ Click nút submit (arrow_forward hoặc "Tạo")
  → Sau mỗi batch: waitForVideos() chờ đủ video render
```

**runImageToVideo()**:
```
Với mỗi task (startImage + endImage + prompt):
  ① Tải ảnh từ server qua background.js (fetch-file)
  ② Upload vào input[type="file"] của Flow
  ③ Click "Bắt đầu" → chọn ảnh start
  ④ Click "Kết thúc" → chọn ảnh end (nếu có)
  ⑤ Gõ prompt → Click Tạo
  → waitForVideos() sau mỗi batch
```

**runIngredientsToVideo()**:
```
Với mỗi ingredient (nhiều ảnh + 1 prompt):
  ① Upload ảnh
  ② Với mỗi ảnh: click picker "Tạo" → chọn ảnh trong thư viện
  ③ Gõ prompt → Click submit (arrow_forward)
  → waitForVideos() sau mỗi batch
```

**waitForVideos()** — chờ render xong:
```
Đếm tiles trước ([data-item-index])
  → Loop mỗi 2.5~5 giây:
      - Nếu có nút "Thử lại": click tự động
      - Kiểm tra loading (spinner, aria-busy, hoặc text xx%)
      - Nếu tiles đủ và ổn định 3 lần liên tiếp → xong
      - Timeout 10 phút → bỏ qua batch
```

### BƯỚC 8 — Báo Cáo Kết Quả

```
content-flow.js gửi log realtime về server:
  → fetch POST /api/agent/log/:taskId { msg }
  → taskQueue.addLog() → emit("log")
  → api.js broadcast qua SSE đến UI dashboard

Khi xong hoàn toàn:
  → port.postMessage({ type: "done" })
  → background.js resolve promise, detach debugger, đóng port
  → content-web.js nhận response → isBusy = false
  → fetch POST /api/agent/finish/:taskId { status: "done" }
  → taskQueue.finish() → task.status = "done"
  → Badge xanh: "✅ Agent: <id>"
```

---

## Sơ Đồ Tổng Hợp

```
┌──────────────────────────────────────────────────────────────────┐
│                        MÁY SERVER                                │
│                                                                  │
│   ┌─────────────┐    ┌──────────────┐    ┌───────────────────┐  │
│   │  Web UI EJS │    │   Express    │    │    TaskQueue      │  │
│   │  :3000      │───▶│   Routes     │───▶│  (in-memory)      │  │
│   │             │    │   api.js     │    │  EventEmitter     │  │
│   └─────────────┘    └──────┬───────┘    └────────┬──────────┘  │
│                             │                     │             │
│                      SSE push task          emit("created")     │
│                             │                     │             │
└─────────────────────────────┼─────────────────────┼────────────┘
                              │                     │
                    ┌─────────▼─────────────────────▼────────────┐
                    │              MÁY KHÁCH (Chrome)             │
                    │                                             │
                    │  ┌──────────────────────────────────────┐  │
                    │  │         CHROME EXTENSION              │  │
                    │  │                                       │  │
                    │  │  content-web.js      background.js    │  │
                    │  │  (localhost:3000)    (service worker) │  │
                    │  │  - Poll/SSE task  →  - CDP typing     │  │
                    │  │  - Inject agentId    - Fetch files    │  │
                    │  │  - Show badge        - Mở tab Flow    │  │
                    │  │                      - Kết nối port   │  │
                    │  │                             │          │  │
                    │  │                    content-flow.js    │  │
                    │  │                    (labs.google/flow) │  │
                    │  │                    - setupPage()      │  │
                    │  │                    - runXxxToVideo()  │  │
                    │  │                    - waitForVideos()  │  │
                    │  └──────────────────────────────────────┘  │
                    └─────────────────────────────────────────────┘
```

---

## Các API Endpoints

| Method | Endpoint | Mô tả |
|--------|----------|-------|
| GET | `/` | Trang chủ — chọn tool |
| GET/POST | `/api` | Text To Video |
| GET/POST | `/api/imageToVideo` | Image To Video |
| GET/POST | `/api/IngredientsToVideo` | Ingredients To Video |
| GET/POST | `/api/gemini` | Phân tích YouTube bằng Gemini AI |
| GET | `/api/agent/stream` | SSE — agent kết nối nhận task real-time |
| GET | `/api/agent/logs/stream` | SSE — UI nhận log real-time |
| POST | `/api/agent/log/:id` | Extension gửi log về server |
| POST | `/api/agent/finish/:id` | Extension báo task xong/lỗi |
| GET | `/api/tasks` | Xem danh sách tất cả tasks |
| GET | `/api/task/:id` | Xem chi tiết 1 task |
| POST | `/api/agent/start` | Khởi động Chrome với extension |
| POST | `/api/agent/stop` | Dừng Chrome |
| GET | `/api/agent/running` | Kiểm tra Chrome có đang chạy |
| GET | `/api/agent/logs` | Lấy logs gần đây |
| GET | `/uploads/:filename` | Truy cập file đã upload |

---

## Công Nghệ CDP (Chrome DevTools Protocol)

Extension dùng CDP để gõ text "thật" vào Google Flow (React nhận đúng `onChange`):

```
content-flow.js muốn gõ text
  → chrome.runtime.sendMessage { action: "cdp-type", tabId, text }
  → background.js:
      1. chrome.debugger.attach(tabId)
      2. Runtime.evaluate: focus textbox
      3. Input.dispatchKeyEvent: Ctrl+A, Backspace (xóa cũ)
      4. Input.insertText: { text }  ← gõ text mới vào
      5. React nhận onChange event → cập nhật state ✅
```

> Lý do cần CDP: React không nhận `el.value = "..."` trực tiếp.
> `Input.insertText` đi qua native input pipeline của Chrome nên React nhận được.

---

## Gemini (Tính Năng Độc Lập)

Không liên quan đến automation Flow. Gọi thẳng Google Gemini API:

```
POST /api/gemini { youtubeUrl, prompt }
  → GoogleGenAI.models.generateContent()
      model: "gemini-3.1-flash-lite-preview"
      parts: [ text: prompt, fileData: { fileUri: youtubeUrl } ]
  → Trả về phân tích nội dung video YouTube
```

---

## Vòng Đời Task

```
pending → running → done
                 ↘ failed
```

| Status | Ý nghĩa |
|--------|---------|
| `pending` | Vừa tạo, chờ agent nhận |
| `running` | Extension đang thực thi trên Google Flow |
| `done` | Hoàn thành thành công |
| `failed` | Có lỗi trong quá trình chạy |

---

## Lưu Ý Quan Trọng

- **TaskQueue reset khi restart server** — task không được lưu vào DB
- **Uploads tự xóa sau 2 ngày** — file ảnh không giữ mãi
- **1 agent xử lý 1 task tại 1 thời điểm** — `isBusy` flag trong content-web.js
- **Background tab**: Chrome flags `--disable-background-timer-throttling` + override `document.visibilityState` để extension chạy được khi tab không được focus
- **Anti-bot**: dùng `realClick()` với đầy đủ pointer/mouse events, random delay, `humanType()` qua CDP thay vì gán `.value` trực tiếp

# Luồng Hoạt Động Dự Án — API Tool + Flow Agent

## 1. Tổng quan

Dự án là một ứng dụng web Express.js cho phép người dùng tạo video tự động trên Google Flow bằng cách điều khiển một Chrome Extension. Server quản lý task và agent Chrome thực thi automation trên trang `labs.google/fx/vi/tools/flow`.

---

## 2. Thành phần chính

- Server Express
  - `app.js`
  - `routes/api.js`
  - `controllers/`
  - `utils/taskQueue.js`
- Giao diện EJS
  - `views/index.ejs`
  - `views/TextToVideo.ejs`
  - `views/ImageToVideo.ejs`
  - `views/IngredientsToVideo.ejs`
  - `views/gemini.ejs`
- Chrome Extension
  - `flow-extension/manifest.json`
  - `flow-extension/background.js`
  - `flow-extension/content-web.js`
  - `flow-extension/content-flow.js`
- Lưu trữ tạm
  - `uploads/`

---

## 3. Luồng tổng thể

```
[Người dùng] → [Web UI localhost:3000] → [TaskQueue] → [Extension] → [Google Flow]
```

- Web UI: tạo task và quản lý agent
- TaskQueue: lưu task trong bộ nhớ, phát task cho agent
- Extension:
  - `content-web.js`: nhận task từ server
  - `background.js`: mở tab Flow và dùng CDP
  - `content-flow.js`: thao tác tự động trên Google Flow

---

## 4. Luồng chi tiết

### Bước 1 — Khởi động agent

1. Người dùng mở `http://localhost:3000`
2. Nhập Chrome Profile path
3. Thực hiện `POST /api/agent/start`
4. Server gọi `startAgent()`
5. Mở Chrome với:
   - `--load-extension=<flow-extension>`
   - `--user-data-dir=<profile>`
   - `http://localhost:3000`
6. Chrome khởi động và extension được nạp

### Bước 2 — Kết nối extension

1. Chrome mở trang localhost
2. `content-web.js` chạy
3. Yêu cầu agentId đến `background.js`
4. Lấy agentId từ `chrome.storage`
5. `content-web.js`:
   - hiển thị badge agent
   - inject hidden `agentId` vào form
   - bắt đầu nhận task qua polling hoặc SSE

### Bước 3 — Tạo task từ UI

1. Người dùng điền form:
   - TextToVideo
   - ImageToVideo
   - IngredientsToVideo
2. Form chứa `agentId`
3. Submit vào API tương ứng
4. Controller:
   - parse dữ liệu
   - lưu file upload vào `uploads/`
   - gọi `taskQueue.create(type, params, agentId)`

### Bước 4 — TaskQueue phân phối task

1. Tạo task object:
   - `id`, `type`, `params`, `targetAgent`, `status`, `logs`, `createdAt`
2. Trạng thái ban đầu: `pending`
3. TaskQueue emit `created`
4. Server cố gắng gửi task đến agent đang online
   - qua SSE nếu có
   - hoặc agent poll đến endpoint lấy task

### Bước 5 — Agent nhận task

1. `content-web.js` nhận task mới
2. Đánh dấu `isBusy = true`
3. Cập nhật badge trạng thái
4. Gửi message đến `background.js`:
   - `{ action: "run-task", taskId, type, params }`

### Bước 6 — Mở tab Google Flow và chuẩn bị

1. `background.js` nhận yêu cầu
2. Tạo tab mới `https://labs.google/fx/vi/tools/flow`
3. Chờ trang load xong
4. Attach CDP debugger vào tab
5. Kết nối port đến `content-flow.js`
6. Gửi lệnh `run` với thông tin task và serverUrl

### Bước 7 — Tự động trên Google Flow

1. `content-flow.js` lắng nghe port `flow-task`
2. Nhận lệnh `run`
3. Chạy đúng hàm theo type:
   - `runTextToVideo()`
   - `runImageToVideo()`
   - `runIngredientsToVideo()`

#### setupPage()

- Chờ login xong
- Click “Dự án mới”
- Chọn tab Video
- Chọn mode Frame hoặc Ingredients
- Chọn tỷ lệ khung hình
- Chọn model
- Chọn x1

#### runTextToVideo()

- Chia prompt thành batch 3–5 prompt
- Với mỗi prompt:
  - tìm textbox
  - gõ text bằng CDP
  - click submit
- Sau mỗi batch: `waitForVideos()`

#### runImageToVideo()

- Tải ảnh từ server
- Upload vào input file
- Chọn ảnh bắt đầu/kết thúc
- Gõ prompt
- Click tạo
- Chờ render xong

#### runIngredientsToVideo()

- Upload ảnh
- Mở picker chọn ảnh
- Gõ prompt
- Submit
- Chờ render xong

#### waitForVideos()

- Đếm số tile trước
- Loop kiểm tra trạng thái
- Nếu thấy nút “Thử lại”, click tự động
- Kiểm tra spinner/`aria-busy`/phần trăm
- Khi kết quả ổn định → hoàn tất
- Timeout sau 10 phút

### Bước 8 — Hoàn thành và báo cáo kết quả

1. `content-flow.js` gửi log về server:
   - `POST /api/agent/log/:taskId`
2. Server lưu log và phát SSE đến UI
3. Khi task xong:
   - `content-flow.js` gửi `{ type: "done" }`
   - `background.js` detach debugger
   - `content-web.js` đặt `isBusy = false`
   - Gọi `POST /api/agent/finish/:taskId`
   - TaskQueue cập nhật `status = done`

---

## 5. Sơ đồ hệ thống

```
SERVER
  Web UI EJS
  Express routes
  TaskQueue (in-memory)
  SSE / polling

CHROME CLIENT
  content-web.js
  background.js
  content-flow.js
```

---

## 6. API chính

- `GET /` — trang chủ
- `GET/POST /api` — Text To Video
- `GET/POST /api/imageToVideo` — Image To Video
- `GET/POST /api/IngredientsToVideo` — Ingredients To Video
- `GET/POST /api/gemini` — Gemini analysis
- `GET /api/agent/stream` — SSE agent nhận task realtime
- `GET /api/agent/logs/stream` — SSE log realtime
- `POST /api/agent/log/:id` — ghi log từ extension
- `POST /api/agent/finish/:id` — báo task xong/lỗi
- `GET /api/tasks` — danh sách task
- `GET /api/task/:id` — chi tiết task
- `POST /api/agent/start` — khởi động Chrome agent
- `POST /api/agent/stop` — dừng Chrome
- `GET /api/agent/running` — kiểm tra agent đang chạy
- `GET /api/agent/logs` — lấy log
- `GET /uploads/:filename` — truy cập file upload

---

## 7. Luồng trạng thái task

- `pending` → `running` → `done`
- `running` → `failed`

Ý nghĩa:

- `pending`: task mới tạo, chờ agent
- `running`: agent đang xử lý
- `done`: hoàn thành
- `failed`: lỗi trong quá trình thực thi

---

## 8. Lưu ý quan trọng

- TaskQueue lưu trong bộ nhớ, reset khi restart server
- Uploads chỉ lưu tạm, tự xóa sau 2 ngày
- Mỗi agent chỉ xử lý 1 task tại một thời điểm
- Dùng CDP để gõ text cho React trên Google Flow
- Dùng click/typing giống người để giảm lỗi anti-bot

var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

const XLSX = require("xlsx");
const { Sequelize } = require("sequelize");
const ejs = require("ejs");
const axios = require("axios");
const FormData = require("form-data");
const fs = require("fs");
require("dotenv").config();

var indexRouter = require("./routes/index");
var usersRouter = require("./routes/users");
const apiRouter = require("./routes/api");

var app = express();

// Tạo thư mục uploads nếu chưa tồn tại
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
  console.log("✓ Thư mục uploads đã được tạo");
}

// Tự động xóa file uploads cũ hơn 2 ngày
function cleanOldUploads() {
  const TWO_DAYS = 2 * 24 * 60 * 60 * 1000;
  const now = Date.now();
  fs.readdir(uploadDir, (err, files) => {
    if (err) return;
    files.forEach((file) => {
      const filePath = path.join(uploadDir, file);
      fs.stat(filePath, (err, stat) => {
        if (err || !stat.isFile()) return;
        if (now - stat.mtimeMs > TWO_DAYS) {
          fs.unlink(filePath, () => {
            console.log(`[cleanup] Đã xóa file cũ: ${file}`);
          });
        }
      });
    });
  });
}
cleanOldUploads(); // chạy ngay khi khởi động
setInterval(cleanOldUploads, 60 * 60 * 1000); // chạy mỗi 1 giờ

// Serve static files
app.use("/uploads", express.static("uploads"));

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

app.use("/", indexRouter);
app.use("/users", usersRouter);
app.use("/api", apiRouter);

// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = app;

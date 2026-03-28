const { app, BrowserWindow } = require('electron');
const { spawn } = require('child_process');
const path = require('path');

let mainWindow;
let expressApp;

function startExpress() {
  expressApp = spawn('node', [path.join(__dirname, 'bin/www')], {
    env: { ...process.env, PORT: 3000 }
  });

  expressApp.stdout.on('data', (data) => {
    console.log(`Express: ${data}`);
  });

  expressApp.stderr.on('data', (data) => {
    console.error(`Express Error: ${data}`);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.setMenuBarVisibility(false);

  // Chờ Express khởi động rồi mới load
  setTimeout(() => {
    mainWindow.loadURL('http://localhost:3000');
  }, 2000);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.on('ready', () => {
  startExpress();
  createWindow();
});

app.on('window-all-closed', () => {
  if (expressApp) expressApp.kill();
  app.quit();
});

app.on('activate', () => {
  if (mainWindow === null) createWindow();
});

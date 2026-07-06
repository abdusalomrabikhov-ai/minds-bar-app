const { app, BrowserWindow, Menu } = require('electron');
const path = require('path');

const APP_URL = 'https://minds-bar-app-production.up.railway.app';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  Menu.setApplicationMenu(null);
  win.loadURL(APP_URL);

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    win.loadURL(`data:text/html,<body style="font-family:sans-serif;padding:40px;text-align:center">
      <h2>Не удалось загрузить TeamTask</h2>
      <p>${errorDescription} (${errorCode})</p>
      <p>Проверьте интернет-соединение и попробуйте снова.</p>
    </body>`);
  });
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

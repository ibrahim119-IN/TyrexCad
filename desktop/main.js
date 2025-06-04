const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const path = require('path');
const fs = require('fs').promises;
const Store = require('electron-store');

let mainWindow;
const store = new Store();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1600,
    height: 900,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '../public/icon.png')
  });

  // تحميل التطبيق
  if (process.env.NODE_ENV === 'development') {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
  }

  // قائمة التطبيق
  const menuTemplate = [
    {
      label: 'File',
      submenu: [
        {
          label: 'Open',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow.webContents.send('menu-action', 'open')
        },
        {
          label: 'Save',
          accelerator: 'CmdOrCtrl+S',
          click: () => mainWindow.webContents.send('menu-action', 'save')
        },
        { type: 'separator' },
        { role: 'quit' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow.webContents.send('menu-action', 'undo')
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow.webContents.send('menu-action', 'redo')
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        { role: 'togglefullscreen' },
        { role: 'toggleDevTools' }
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// IPC Handlers
ipcMain.handle('show-open-dialog', async (event, options) => {
  return dialog.showOpenDialog(mainWindow, options);
});

ipcMain.handle('show-save-dialog', async (event, options) => {
  return dialog.showSaveDialog(mainWindow, options);
});

ipcMain.handle('read-file', async (event, filePath) => {
  return fs.readFile(filePath, 'utf8');
});

ipcMain.handle('write-file', async (event, filePath, data) => {
  return fs.writeFile(filePath, data, 'utf8');
});

ipcMain.handle('get-system-info', () => {
  return {
    platform: process.platform,
    version: process.getSystemVersion(),
    arch: process.arch,
    memory: process.getSystemMemoryInfo()
  };
});

ipcMain.handle('toggle-fullscreen', () => {
  mainWindow.setFullScreen(!mainWindow.isFullScreen());
});

// Recent files
const recentFiles = [];

ipcMain.handle('get-recent-files', () => {
  return recentFiles.slice(0, 10);
});

ipcMain.handle('add-to-recent-files', (event, filePath) => {
  const fileName = path.basename(filePath);
  recentFiles.unshift({ path: filePath, name: fileName });
  if (recentFiles.length > 10) recentFiles.pop();
});

// Storage handlers
ipcMain.handle('storage-get', (event, key) => {
  return store.get(key);
});

ipcMain.handle('storage-set', (event, key, value) => {
  return store.set(key, value);
});

ipcMain.handle('storage-delete', (event, key) => {
  return store.delete(key);
});

ipcMain.handle('storage-list', (event, prefix) => {
  const allKeys = Object.keys(store.store);
  return prefix ? allKeys.filter(key => key.startsWith(prefix)) : allKeys;
});

ipcMain.handle('storage-clear', () => {
  return store.clear();
});
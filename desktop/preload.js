const { contextBridge, ipcRenderer } = require('electron');

// Expose protected APIs to renderer
contextBridge.exposeInMainWorld('electronAPI', {
  // File operations
  showOpenDialog: (options) => ipcRenderer.invoke('show-open-dialog', options),
  showSaveDialog: (options) => ipcRenderer.invoke('show-save-dialog', options),
  readFile: (filePath) => ipcRenderer.invoke('read-file', filePath),
  writeFile: (filePath, data) => ipcRenderer.invoke('write-file', filePath, data),
  
  // System info
  getSystemInfo: () => ipcRenderer.invoke('get-system-info'),
  
  // Window controls
  toggleFullscreen: () => ipcRenderer.invoke('toggle-fullscreen'),
  
  // Recent files
  getRecentFiles: () => ipcRenderer.invoke('get-recent-files'),
  addToRecentFiles: (filePath) => ipcRenderer.invoke('add-to-recent-files', filePath),
  
  // Storage API
  storage: {
    get: async (key) => {
      const store = await ipcRenderer.invoke('storage-get', key);
      return store;
    },
    set: async (key, value) => {
      return ipcRenderer.invoke('storage-set', key, value);
    },
    delete: async (key) => {
      return ipcRenderer.invoke('storage-delete', key);
    },
    list: async (prefix) => {
      return ipcRenderer.invoke('storage-list', prefix);
    },
    clear: async () => {
      return ipcRenderer.invoke('storage-clear');
    }
  },
  
  // Resource URLs
  getResourceUrl: (resource) => {
    // في Electron، الموارد من التطبيق المحلي
    return new URL(resource, 'file://').href;
  },
  
  // Menu actions
  onMenuAction: (callback) => {
    ipcRenderer.on('menu-action', (event, action) => callback(action));
  }
});
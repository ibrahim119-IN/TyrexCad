/**
 * Desktop Features Module - مزايا خاصة بسطح المكتب
 * 
 * يعمل فقط في بيئة Electron
 */

export default class DesktopFeaturesModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // كشف بيئة Electron
    this.isElectron = !!(typeof window !== 'undefined' && window.electronAPI);
    
    // إحصائيات
    this.stats = {
      filesOpened: 0,
      filesSaved: 0,
      operations: 0
    };
    
    this.setupHandlers();
    
    // بث رسالة الجاهزية
    this.msg.emit('desktop.ready', {
      version: this.version,
      available: this.isElectron
    });
  }

  setupHandlers() {
    // فتح ملف
    this.msg.on('desktop.openFile', async (message) => {
      if (!this.isElectron) {
        this.replyNotAvailable(message.requestId);
        return;
      }
      
      try {
        const result = await window.electronAPI.showOpenDialog({
          filters: message.data.filters || [
            { name: 'CAD Files', extensions: ['step', 'iges', 'stl', 'dxf'] },
            { name: 'All Files', extensions: ['*'] }
          ],
          properties: ['openFile']
        });
        
        if (!result.canceled && result.filePaths.length > 0) {
          const filePath = result.filePaths[0];
          const fileData = await window.electronAPI.readFile(filePath);
          
          this.stats.filesOpened++;
          
          if (message.requestId) {
            this.msg.reply(message.requestId, {
              success: true,
              result: {
                path: filePath,
                data: fileData,
                name: this.getFileName(filePath)
              }
            });
          }
          
          this.msg.emit('desktop.fileOpened', {
            path: filePath,
            name: this.getFileName(filePath)
          });
        } else {
          if (message.requestId) {
            this.msg.reply(message.requestId, {
              success: false,
              error: 'User canceled'
            });
          }
        }
      } catch (error) {
        this.handleError(message.requestId, error);
      }
    });

    // حفظ ملف
    this.msg.on('desktop.saveFile', async (message) => {
      if (!this.isElectron) {
        this.replyNotAvailable(message.requestId);
        return;
      }
      
      const { data, defaultPath, filters } = message.data;
      
      try {
        const result = await window.electronAPI.showSaveDialog({
          defaultPath,
          filters: filters || [
            { name: 'CAD Files', extensions: ['step', 'iges', 'stl'] },
            { name: 'All Files', extensions: ['*'] }
          ]
        });
        
        if (!result.canceled) {
          await window.electronAPI.writeFile(result.filePath, data);
          
          this.stats.filesSaved++;
          
          if (message.requestId) {
            this.msg.reply(message.requestId, {
              success: true,
              result: {
                path: result.filePath,
                name: this.getFileName(result.filePath)
              }
            });
          }
          
          this.msg.emit('desktop.fileSaved', {
            path: result.filePath
          });
        } else {
          if (message.requestId) {
            this.msg.reply(message.requestId, {
              success: false,
              error: 'User canceled'
            });
          }
        }
      } catch (error) {
        this.handleError(message.requestId, error);
      }
    });

    // معلومات النظام
    this.msg.on('desktop.getSystemInfo', async (message) => {
      if (!this.isElectron) {
        this.replyNotAvailable(message.requestId);
        return;
      }
      
      try {
        const info = await window.electronAPI.getSystemInfo();
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: info
          });
        }
      } catch (error) {
        this.handleError(message.requestId, error);
      }
    });

    // ملء الشاشة
    this.msg.on('desktop.toggleFullscreen', async (message) => {
      if (!this.isElectron) {
        this.replyNotAvailable(message.requestId);
        return;
      }
      
      try {
        await window.electronAPI.toggleFullscreen();
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true
          });
        }
      } catch (error) {
        this.handleError(message.requestId, error);
      }
    });

    // قائمة ملفات مؤخراً
    this.msg.on('desktop.getRecentFiles', async (message) => {
      if (!this.isElectron) {
        this.replyNotAvailable(message.requestId);
        return;
      }
      
      try {
        const recentFiles = await window.electronAPI.getRecentFiles();
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: recentFiles
          });
        }
      } catch (error) {
        this.handleError(message.requestId, error);
      }
    });

    // إضافة لقائمة الملفات المؤخرة
    this.msg.on('desktop.addToRecent', async (message) => {
      if (!this.isElectron) return;
      
      const { path } = message.data;
      
      try {
        await window.electronAPI.addToRecentFiles(path);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true
          });
        }
      } catch (error) {
        this.handleError(message.requestId, error);
      }
    });

    // تحديث قائمة التطبيق
    this.msg.on('desktop.updateMenu', async (message) => {
      if (!this.isElectron) return;
      
      const { menuTemplate } = message.data;
      
      try {
        await window.electronAPI.updateMenu(menuTemplate);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true
          });
        }
      } catch (error) {
        this.handleError(message.requestId, error);
      }
    });

    // معلومات الموديول
    this.msg.on('desktop.info', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            version: this.version,
            available: this.isElectron,
            stats: this.stats
          }
        });
      }
    });
  }

  replyNotAvailable(requestId) {
    if (requestId) {
      this.msg.reply(requestId, {
        success: false,
        error: 'Desktop features not available in browser'
      });
    }
  }

  handleError(requestId, error) {
    console.error('Desktop operation error:', error);
    
    if (requestId) {
      this.msg.reply(requestId, {
        success: false,
        error: error.message
      });
    }
    
    this.msg.emit('desktop.error', {
      error: error.message
    });
  }

  getFileName(filePath) {
    return filePath.split(/[/\\]/).pop();
  }

  // دورة الحياة
  async start() {
    console.log('Desktop features module started');
    
    if (this.isElectron) {
      // تسجيل اختصارات لوحة المفاتيح
      this.msg.on('shell.shortcut', (message) => {
        const { action } = message.data;
        
        switch (action) {
          case 'save':
            this.msg.emit('app.save');
            break;
          case 'open':
            this.msg.emit('desktop.openFile', {});
            break;
        }
      });
    }
  }

  async stop() {
    // لا شيء للتنظيف
  }

  async healthCheck() {
    return true;
  }

  async cleanup() {
    this.msg.off('desktop.*');
    this.msg.off('shell.shortcut');
  }
}
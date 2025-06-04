/**
 * Storage Module - تجريد التخزين عبر المنصات
 * 
 * يوفر واجهة موحدة للتخزين تعمل على:
 * - Web: localStorage/IndexedDB
 * - Desktop: electron-store/filesystem
 * - Future: cloud storage
 */

// Storage Providers - نسخة مبسطة
class WebStorageProvider {
  constructor() {
    this.type = 'web';
    this.prefix = 'tyrexcad:';
  }

  async get(key) {
    const value = localStorage.getItem(this.prefix + key);
    if (value === null) return undefined;
    
    try {
      return JSON.parse(value);
    } catch {
      return value; // إذا لم يكن JSON، أرجع كـ string
    }
  }

  async set(key, value) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    localStorage.setItem(this.prefix + key, serialized);
  }

  async delete(key) {
    localStorage.removeItem(this.prefix + key);
  }

  async list(prefix = '') {
    const keys = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.prefix + prefix)) {
        keys.push(key.replace(this.prefix, ''));
      }
    }
    return keys;
  }

  async clear() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key.startsWith(this.prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
}

class ElectronStorageProvider {
  constructor() {
    this.type = 'electron';
    // Fallback to web storage if Electron not available
    this.fallback = new WebStorageProvider();
  }

  async get(key) {
    if (!window.electronAPI?.storage) {
      return this.fallback.get(key);
    }
    return window.electronAPI.storage.get(key);
  }

  async set(key, value) {
    if (!window.electronAPI?.storage) {
      return this.fallback.set(key, value);
    }
    return window.electronAPI.storage.set(key, value);
  }

  async delete(key) {
    if (!window.electronAPI?.storage) {
      return this.fallback.delete(key);
    }
    return window.electronAPI.storage.delete(key);
  }

  async list(prefix = '') {
    if (!window.electronAPI?.storage) {
      return this.fallback.list(prefix);
    }
    return window.electronAPI.storage.list(prefix);
  }

  async clear() {
    if (!window.electronAPI?.storage) {
      return this.fallback.clear();
    }
    return window.electronAPI.storage.clear();
  }
}

// Main Storage Module
export default class StorageModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // كشف المنصة واختيار Provider
    this.provider = this.detectProvider();
    
    // Cache للأداء
    this.cache = new Map();
    this.cacheTimeout = 60000; // 60 ثانية بدلاً من 5
    
    // معلومات التخزين
    this.stats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    this.setupHandlers();
    
    // بث رسالة الجاهزية
    this.msg.emit('storage.ready', {
      provider: this.provider.type,
      version: this.version
    });
  }

  detectProvider() {
    // كشف Electron
    if (typeof window !== 'undefined' && window.electronAPI) {
      console.log('Storage: Using Electron provider');
      return new ElectronStorageProvider();
    }
    
    // الافتراضي: Web Storage
    console.log('Storage: Using Web provider');
    return new WebStorageProvider();
  }

  async initializeProvider() {
    try {
      if (this.provider.init) {
        await this.provider.init();
      }
      
      this.msg.emit('storage.ready', {
        provider: this.provider.type,
        version: this.version
      });
    } catch (error) {
      console.error('Storage initialization error:', error);
      this.msg.emit('storage.error', {
        type: 'initialization',
        error: error.message
      });
    }
  }

  setupHandlers() {
    // الحصول على قيمة
    this.msg.on('storage.get', async (message) => {
      const { key, useCache = true } = message.data;
      
      try {
        // التحقق من الكاش
        if (useCache && this.cache.has(key)) {
          const cached = this.cache.get(key);
          if (Date.now() - cached.time < this.cacheTimeout) {
            this.stats.cacheHits++;
            this.stats.reads++; // نحسبها كقراءة حتى لو من الكاش
            if (message.requestId) {
              this.msg.reply(message.requestId, {
                success: true,
                result: cached.value
              });
            }
            return;
          }
        }
        
        this.stats.cacheMisses++;
        this.stats.reads++;
        
        const value = await this.provider.get(key);
        
        // تحديث الكاش
        if (useCache && value !== undefined) {
          this.cache.set(key, {
            value,
            time: Date.now()
          });
        }
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: value
          });
        }
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // تعيين قيمة
    this.msg.on('storage.set', async (message) => {
      const { key, value, broadcast = true } = message.data;
      
      try {
        this.stats.writes++;
        
        await this.provider.set(key, value);
        
        // تحديث الكاش
        this.cache.set(key, {
          value,
          time: Date.now()
        });
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true
          });
        }
        
        // بث التغيير
        if (broadcast) {
          this.msg.emit('storage.changed', {
            key,
            value,
            timestamp: Date.now()
          });
        }
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // حذف قيمة
    this.msg.on('storage.delete', async (message) => {
      const { key } = message.data;
      
      try {
        this.stats.deletes++;
        
        await this.provider.delete(key);
        
        // إزالة من الكاش
        this.cache.delete(key);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true
          });
        }
        
        this.msg.emit('storage.deleted', { key });
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // قائمة المفاتيح
    this.msg.on('storage.list', async (message) => {
      const { prefix = '' } = message.data;
      
      try {
        const keys = await this.provider.list(prefix);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: keys
          });
        }
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // مسح جميع البيانات
    this.msg.on('storage.clear', async (message) => {
      try {
        await this.provider.clear();
        
        // مسح الكاش
        this.cache.clear();
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true
          });
        }
        
        this.msg.emit('storage.cleared', {
          timestamp: Date.now()
        });
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // معلومات التخزين
    this.msg.on('storage.info', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            provider: this.provider.type,
            stats: this.stats,
            cacheSize: this.cache.size,
            version: this.version
          }
        });
      }
    });

    // معاملات (Transactions)
    this.msg.on('storage.transaction', async (message) => {
      const { operations } = message.data;
      const results = [];
      const rollback = [];
      
      try {
        for (const op of operations) {
          switch (op.type) {
            case 'set':
              const oldValue = await this.provider.get(op.key);
              rollback.push({ type: 'set', key: op.key, value: oldValue });
              await this.provider.set(op.key, op.value);
              results.push({ success: true });
              break;
              
            case 'delete':
              const deletedValue = await this.provider.get(op.key);
              if (deletedValue !== undefined) {
                rollback.push({ type: 'set', key: op.key, value: deletedValue });
              }
              await this.provider.delete(op.key);
              results.push({ success: true });
              break;
          }
        }
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: results
          });
        }
      } catch (error) {
        // Rollback
        console.error('Transaction failed, rolling back:', error);
        for (const op of rollback.reverse()) {
          try {
            if (op.type === 'set') {
              await this.provider.set(op.key, op.value);
            }
          } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError);
          }
        }
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });
  }

  // دورة الحياة
  async start() {
    console.log('Storage module started');
  }

  async stop() {
    // حفظ أي بيانات معلقة
    this.cache.clear();
  }

  async healthCheck() {
    try {
      // اختبار بسيط للقراءة/الكتابة
      const testKey = '__health_check__';
      const testValue = Date.now();
      
      await this.provider.set(testKey, testValue);
      const retrieved = await this.provider.get(testKey);
      await this.provider.delete(testKey);
      
      return retrieved === testValue;
    } catch (error) {
      console.error('Storage health check failed:', error);
      return false;
    }
  }

  async cleanup() {
    this.cache.clear();
    this.msg.off('storage.*');
  }
}
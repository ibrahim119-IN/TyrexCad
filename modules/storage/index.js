/**
 * Storage Module - تجريد التخزين عبر المنصات
 * @module StorageModule
 * @version 1.0.1
 */

// Storage Providers
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
      if (key && key.startsWith(this.prefix + prefix)) {
        keys.push(key.replace(this.prefix, ''));
      }
    }
    return keys;
  }

  async clear() {
    const keysToRemove = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith(this.prefix)) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => localStorage.removeItem(key));
  }
}

class ElectronStorageProvider {
  constructor() {
    this.type = 'electron';
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

/**
 * Storage Module - يوفر واجهة موحدة للتخزين عبر المنصات
 * @class
 */
export default class StorageModule {
  /**
   * @param {MessageAPI} messageAPI - واجهة الرسائل
   */
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.1';
    
    // كشف المنصة واختيار Provider
    this.provider = this.detectProvider();
    
    // Cache للأداء مع حدود
    this.cache = new Map();
    this.cacheTimeout = 60000; // 60 ثانية
    this.maxCacheSize = 1000; // حد أقصى للعناصر
    
    // معلومات التخزين
    this.stats = {
      reads: 0,
      writes: 0,
      deletes: 0,
      cacheHits: 0,
      cacheMisses: 0,
      errors: 0
    };
    
    this.setupHandlers();
    
    // بث رسالة الجاهزية
    this.msg.emit('storage.ready', {
      provider: this.provider.type,
      version: this.version
    });
  }

  detectProvider() {
    if (typeof window !== 'undefined' && window.electronAPI) {
      console.log('Storage: Using Electron provider');
      return new ElectronStorageProvider();
    }
    
    console.log('Storage: Using Web provider');
    return new WebStorageProvider();
  }

  setupHandlers() {
    // الحصول على قيمة
    this.msg.on('storage.get', async (message) => {
      const { key, useCache = true } = message.data;
      
      try {
        // التحقق من الكاش إذا كان مفعلاً
        if (useCache === true && this.cache.has(key)) {
          const cached = this.cache.get(key);
          if (Date.now() - cached.time < this.cacheTimeout) {
            this.stats.cacheHits++;
            this.stats.reads++;
            if (message.requestId) {
              this.msg.reply(message.requestId, {
                success: true,
                result: cached.value
              });
            }
            return;
          } else {
            // حذف من الكاش إذا انتهت صلاحيته
            this.cache.delete(key);
          }
        }
        
        this.stats.cacheMisses++;
        this.stats.reads++;
        
        const value = await this.provider.get(key);
        
        // تحديث الكاش
        if (useCache !== false && value !== undefined) {
          this.updateCache(key, value);
        }
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: value
          });
        }
      } catch (error) {
        this.stats.errors++;
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
        this.updateCache(key, value);
        
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
        this.stats.errors++;
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
        this.stats.errors++;
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
        this.stats.errors++;
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
        this.stats.errors++;
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
            maxCacheSize: this.maxCacheSize,
            cacheTimeout: this.cacheTimeout,
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
              
            default:
              throw new Error(`Unknown operation type: ${op.type}`);
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
            if (op.type === 'set' && op.value !== undefined) {
              await this.provider.set(op.key, op.value);
            }
          } catch (rollbackError) {
            console.error('Rollback failed:', rollbackError);
          }
        }
        
        this.stats.errors++;
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });
  }

  /**
   * تحديث الكاش مع إدارة الحجم
   */
  updateCache(key, value) {
    // حذف الأقدم إذا وصلنا للحد الأقصى
    if (this.cache.size >= this.maxCacheSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }
    
    this.cache.set(key, {
      value,
      time: Date.now()
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
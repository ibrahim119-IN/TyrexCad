/**
 * Resources Module - تجريد تحميل الموارد
 * 
 * يوفر واجهة موحدة لتحميل:
 * - WASM files
 * - Assets (images, fonts, etc.)
 * - Configuration files
 * - Any binary/text resources
 */

export default class ResourcesModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // Cache للموارد المحملة
    this.cache = new Map();
    
    // إعدادات
    this.config = {
      baseUrl: '/',
      cacheEnabled: true,
      maxCacheSize: 100 * 1024 * 1024, // 100MB
      timeout: 30000, // 30 ثانية
      retryAttempts: 3,
      retryDelay: 1000
    };
    
    // إحصائيات
    this.stats = {
      loaded: 0,
      cached: 0,
      errors: 0,
      totalBytes: 0,
      cacheHits: 0,
      cacheMisses: 0
    };
    
    // قائمة الموارد المحملة
    this.loadedResources = new Map();
    
    this.setupHandlers();
    
    // بث رسالة الجاهزية
    this.msg.emit('resources.ready', {
      version: this.version,
      baseUrl: this.config.baseUrl
    });
  }

  setupHandlers() {
    // تحميل مورد
    this.msg.on('resources.load', async (message) => {
      const { resource, type = 'auto', options = {} } = message.data;
      
      try {
        const data = await this.loadResource(resource, type, options);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: data
          });
        }
        
        this.msg.emit('resources.loaded', {
          resource,
          type: data.type,
          size: data.size
        });
      } catch (error) {
        this.stats.errors++;
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
        
        this.msg.emit('resources.error', {
          resource,
          error: error.message
        });
      }
    });

    // الحصول على URL للمورد
    this.msg.on('resources.getUrl', (message) => {
      const { resource, absolute = false } = message.data;
      
      try {
        const url = this.getResourceUrl(resource, absolute);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: url
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

    // تحميل مسبق للموارد
    this.msg.on('resources.preload', async (message) => {
      const { resources } = message.data;
      const results = [];
      
      for (const resource of resources) {
        try {
          await this.loadResource(resource.path, resource.type, { preload: true });
          results.push({ resource: resource.path, success: true });
        } catch (error) {
          results.push({ resource: resource.path, success: false, error: error.message });
        }
      }
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: results
        });
      }
    });

    // مسح الكاش
    this.msg.on('resources.clearCache', (message) => {
      this.cache.clear();
      this.stats.cached = 0;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true
        });
      }
      
      this.msg.emit('resources.cacheCleared', {
        timestamp: Date.now()
      });
    });

    // معلومات الموارد
    this.msg.on('resources.info', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            stats: this.stats,
            cacheSize: this.getCacheSize(),
            loadedCount: this.loadedResources.size,
            config: this.config,
            version: this.version
          }
        });
      }
    });
  }

  /**
   * تحميل مورد
   */
  async loadResource(resourcePath, type = 'auto', options = {}) {
    // التحقق من الكاش
    const cacheKey = `${resourcePath}:${type}`;
    
    if (this.config.cacheEnabled && this.cache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.cache.get(cacheKey);
    }
    
    this.stats.cacheMisses++;
    
    // بناء URL
    const url = this.getResourceUrl(resourcePath);
    
    // محاولة التحميل مع إعادة المحاولة
    let lastError;
    for (let attempt = 0; attempt < this.config.retryAttempts; attempt++) {
      try {
        const data = await this.fetchResource(url, type, options);
        
        // إضافة للكاش
        if (this.config.cacheEnabled && !options.noCache) {
          this.addToCache(cacheKey, data);
        }
        
        // تسجيل المورد المحمل
        this.loadedResources.set(resourcePath, {
          type: data.type,
          size: data.size,
          loadedAt: Date.now()
        });
        
        this.stats.loaded++;
        this.stats.totalBytes += data.size;
        
        return data;
      } catch (error) {
        lastError = error;
        if (attempt < this.config.retryAttempts - 1) {
          await this.delay(this.config.retryDelay * (attempt + 1));
        }
      }
    }
    
    throw lastError || new Error('Failed to load resource');
  }

  /**
   * جلب المورد من الشبكة
   */
  async fetchResource(url, type, options) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), options.timeout || this.config.timeout);
    
    try {
      const response = await fetch(url, {
        signal: controller.signal,
        ...options.fetchOptions
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`Failed to load resource: ${response.status} ${response.statusText}`);
      }
      
      // تحديد النوع تلقائياً
      if (type === 'auto') {
        type = this.detectType(url, response.headers.get('content-type'));
      }
      
      let data;
      let size;
      
      switch (type) {
        case 'json':
          data = await response.json();
          size = new Blob([JSON.stringify(data)]).size;
          break;
          
        case 'text':
          data = await response.text();
          size = new Blob([data]).size;
          break;
          
        case 'blob':
          data = await response.blob();
          size = data.size;
          break;
          
        case 'arraybuffer':
        case 'wasm':
          data = await response.arrayBuffer();
          size = data.byteLength;
          break;
          
        default:
          // افتراضي: arraybuffer
          data = await response.arrayBuffer();
          size = data.byteLength;
      }
      
      return {
        type,
        data,
        size,
        url,
        contentType: response.headers.get('content-type')
      };
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  }

  /**
   * كشف نوع المورد
   */
  detectType(url, contentType) {
    // بناءً على الامتداد
    const ext = url.split('.').pop().toLowerCase();
    
    switch (ext) {
      case 'json':
        return 'json';
      case 'txt':
      case 'md':
      case 'css':
      case 'js':
        return 'text';
      case 'wasm':
        return 'wasm';
      case 'jpg':
      case 'jpeg':
      case 'png':
      case 'gif':
      case 'webp':
      case 'svg':
        return 'blob';
      default:
        // بناءً على content-type
        if (contentType) {
          if (contentType.includes('json')) return 'json';
          if (contentType.includes('text')) return 'text';
          if (contentType.includes('wasm')) return 'wasm';
          if (contentType.includes('image')) return 'blob';
        }
        return 'arraybuffer';
    }
  }

  /**
   * بناء URL للمورد
   */
  getResourceUrl(resourcePath, absolute = false) {
    // التحقق من URL مطلق
    if (resourcePath.startsWith('http://') || resourcePath.startsWith('https://')) {
      return resourcePath;
    }
    
    // في Electron
    if (typeof window !== 'undefined' && window.electronAPI?.getResourceUrl) {
      return window.electronAPI.getResourceUrl(resourcePath);
    }
    
    // في الويب
    const base = absolute && typeof window !== 'undefined' ? window.location.origin : '';
    const cleanBase = this.config.baseUrl.endsWith('/') ? 
      this.config.baseUrl.slice(0, -1) : this.config.baseUrl;
    const cleanPath = resourcePath.startsWith('/') ? resourcePath : `/${resourcePath}`;
    
    return base + cleanBase + cleanPath;
  }

  /**
   * إضافة للكاش
   */
  addToCache(key, data) {
    // التحقق من حجم الكاش
    if (this.getCacheSize() + data.size > this.config.maxCacheSize) {
      // حذف الأقدم (LRU)
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey) {
        this.cache.delete(oldestKey);
      }
    }
    
    this.cache.set(key, data);
    this.stats.cached++;
  }

  /**
   * حساب حجم الكاش
   */
  getCacheSize() {
    let size = 0;
    for (const data of this.cache.values()) {
      size += data.size;
    }
    return size;
  }

  /**
   * تأخير للإعادة
   */
  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // دورة الحياة
  async start() {
    console.log('Resources module started');
  }

  async stop() {
    // مسح الكاش عند الإيقاف
    this.cache.clear();
  }

  async healthCheck() {
    return true; // Resources module لا يحتاج health check حقيقي
  }

  async cleanup() {
    this.cache.clear();
    this.loadedResources.clear();
    this.msg.off('resources.*');
  }
}
/**
 * Module Loader - محمل الوحدات
 * 
 * مسؤول عن تحميل وإدارة جميع الوحدات في النظام
 * يحقن MessageAPI لكل وحدة ويضمن العزل التام
 */

import { createMessageAPI } from './message-bus.js';

export class ModuleLoader {
  constructor(messageBus, lifecycleManager) {
    if (!messageBus) {
      throw new Error('MessageBus is required');
    }
    if (!lifecycleManager) {
      throw new Error('LifecycleManager is required');
    }
    
    this.messageBus = messageBus;
    this.lifecycle = lifecycleManager;
    this.modules = new Map();
    this.loadOrder = [];
    this.moduleRegistry = new Map(); // تسجيل أنواع الوحدات
    
    // إعدادات
    this.config = {
      enableHotReload: false,
      moduleTimeout: 10000,
      retryAttempts: 3,
      retryDelay: 1000
    };
    
    this.setupHandlers();
  }

  setupHandlers() {
    // طلب تحميل وحدة
    this.messageBus.on('module.load', async (message) => {
      const { name } = message.data;
      try {
        const module = await this.loadModule(name);
        if (message.requestId) {
          this.messageBus.reply(message.requestId, {
            success: true,
            result: { name, loaded: true }
          });
        }
      } catch (error) {
        if (message.requestId) {
          this.messageBus.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // طلب إلغاء تحميل وحدة
    this.messageBus.on('module.unload', async (message) => {
      const { name } = message.data;
      try {
        await this.unloadModule(name);
        if (message.requestId) {
          this.messageBus.reply(message.requestId, {
            success: true,
            result: { name, unloaded: true }
          });
        }
      } catch (error) {
        if (message.requestId) {
          this.messageBus.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // طلب قائمة الوحدات
    this.messageBus.on('module.list', (message) => {
      const modules = Array.from(this.modules.entries()).map(([name, info]) => ({
        name,
        status: info.status,
        loadedAt: info.loadedAt,
        version: info.version
      }));
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result: modules
        });
      }
    });
  }

  /**
   * تسجيل نوع وحدة (يُستخدم قبل التحميل)
   */
  registerModuleType(name, ModuleClass) {
    if (typeof ModuleClass !== 'function') {
      throw new Error(`Module ${name} must be a class or constructor function`);
    }
    this.moduleRegistry.set(name, ModuleClass);
  }

  /**
   * تحميل وحدة
   */
  async loadModule(name, modulePath = null) {
    if (this.modules.has(name)) {
      throw new Error(`Module ${name} is already loaded`);
    }

    console.log(`Loading module: ${name}`);
    
    // معلومات الوحدة
    const moduleInfo = {
      name,
      instance: null,
      status: 'loading',
      loadedAt: null,
      version: null,
      retries: 0
    };

    this.modules.set(name, moduleInfo);

    try {
      // الحصول على الوحدة - من السجل أو بالتحميل الديناميكي
      let ModuleClass = this.moduleRegistry.get(name);
      
      if (!ModuleClass) {
        // تحميل ديناميكي
        const path = modulePath || `/modules/${name}/index.js`;
        const module = await import(path);
        ModuleClass = module.default;
        
        // حفظ في السجل للاستخدام المستقبلي
        this.moduleRegistry.set(name, ModuleClass);
      }

      // إنشاء MessageAPI معزول للوحدة
      const messageAPI = createMessageAPI(this.messageBus, name);
      
      // إنشاء instance من الوحدة
      const instance = new ModuleClass(messageAPI);
      
      // تحديث معلومات الوحدة
      moduleInfo.instance = instance;
      moduleInfo.status = 'loaded';
      moduleInfo.loadedAt = Date.now();
      moduleInfo.version = instance.version || '1.0.0';
      
      // تسجيل في lifecycle manager
      this.lifecycle.registerModule(name, instance);
      
      // إضافة لترتيب التحميل
      this.loadOrder.push(name);
      
      // بث حدث نجاح التحميل
      this.messageBus.emit('module.loaded', {
        name,
        version: moduleInfo.version
      });
      
      console.log(`✓ Module ${name} loaded successfully`);
      return instance;
      
    } catch (error) {
      moduleInfo.status = 'error';
      this.modules.delete(name);
      
      // بث حدث فشل التحميل
      this.messageBus.emit('module.loadError', {
        name,
        error: error.message,
        stack: error.stack
      });
      
      throw new Error(`Failed to load module ${name}: ${error.message}`);
    }
  }

  /**
   * إلغاء تحميل وحدة
   */
  async unloadModule(name) {
    const moduleInfo = this.modules.get(name);
    if (!moduleInfo) {
      throw new Error(`Module ${name} is not loaded`);
    }

    console.log(`Unloading module: ${name}`);
    
    try {
      // إلغاء تسجيل من lifecycle
      await this.lifecycle.unregisterModule(name);
      
      // تنظيف الموارد إذا كانت الوحدة تدعم ذلك
      if (moduleInfo.instance && typeof moduleInfo.instance.cleanup === 'function') {
        await moduleInfo.instance.cleanup();
      }
      
      // إزالة من القوائم
      this.modules.delete(name);
      this.loadOrder = this.loadOrder.filter(n => n !== name);
      
      // بث حدث إلغاء التحميل
      this.messageBus.emit('module.unloaded', { name });
      
      console.log(`✓ Module ${name} unloaded successfully`);
      
    } catch (error) {
      throw new Error(`Failed to unload module ${name}: ${error.message}`);
    }
  }

  /**
   * إعادة تحميل وحدة (Hot Reload)
   */
  async reloadModule(name) {
    if (!this.config.enableHotReload) {
      throw new Error('Hot reload is disabled');
    }
    
    const moduleInfo = this.modules.get(name);
    if (!moduleInfo) {
      throw new Error(`Module ${name} is not loaded`);
    }
    
    console.log(`Reloading module: ${name}`);
    
    // إلغاء التحميل
    await this.unloadModule(name);
    
    // إعادة التحميل
    await this.loadModule(name);
    
    console.log(`✓ Module ${name} reloaded successfully`);
  }

  /**
   * تحميل عدة وحدات بالترتيب
   */
  async loadModules(moduleNames) {
    const results = {
      loaded: [],
      failed: []
    };
    
    for (const name of moduleNames) {
      try {
        await this.loadModule(name);
        results.loaded.push(name);
      } catch (error) {
        console.error(`Failed to load module ${name}:`, error);
        results.failed.push({ name, error: error.message });
      }
    }
    
    return results;
  }

  /**
   * الحصول على معلومات وحدة
   */
  getModuleInfo(name) {
    return this.modules.get(name);
  }

  /**
   * الحصول على جميع الوحدات المحملة
   */
  getLoadedModules() {
    return Array.from(this.modules.keys());
  }

  /**
   * التحقق من تحميل وحدة
   */
  isModuleLoaded(name) {
    const info = this.modules.get(name);
    return info && info.status === 'loaded';
  }

  /**
   * تنظيف جميع الوحدات
   */
  async cleanup() {
    console.log('Cleaning up all modules...');
    
    // إلغاء تحميل بالترتيب العكسي
    const modulesToUnload = [...this.loadOrder].reverse();
    
    for (const name of modulesToUnload) {
      try {
        await this.unloadModule(name);
      } catch (error) {
        console.error(`Error unloading module ${name}:`, error);
      }
    }
    
    this.modules.clear();
    this.loadOrder = [];
    this.moduleRegistry.clear();
  }

  /**
   * تفعيل/تعطيل Hot Reload
   */
  setHotReload(enabled) {
    this.config.enableHotReload = enabled;
    
    if (enabled) {
      console.log('Hot reload enabled');
    } else {
      console.log('Hot reload disabled');
    }
  }
}
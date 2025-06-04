/**
 * Lifecycle Manager - مدير دورة حياة الوحدات
 * 
 * يتتبع حالة جميع الوحدات ويديرها
 * يضمن التشغيل والإيقاف الآمن
 */

export class LifecycleManager {
  constructor(messageBus) {
    if (!messageBus) {
      throw new Error('MessageBus is required');
    }
    
    this.messageBus = messageBus;
    this.modules = new Map();
    this.healthChecks = new Map();
    this.restartAttempts = new Map();
    
    this.config = {
      healthCheckInterval: 5000, // 5 ثواني
      maxRestartAttempts: 3,
      restartDelay: 2000,
      gracefulShutdownTimeout: 10000
    };
    
    this.isShuttingDown = false;
    this.healthCheckTimer = null;
    
    this.setupHandlers();
  }

  setupHandlers() {
    // طلب معلومات دورة الحياة
    this.messageBus.on('lifecycle.status', (message) => {
      const status = this.getSystemStatus();
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result: status
        });
      }
    });

    // إيقاف النظام
    this.messageBus.on('system.shutdown', async () => {
      await this.shutdown();
    });
  }

  /**
   * تسجيل وحدة
   */
  registerModule(name, instance) {
    if (this.modules.has(name)) {
      throw new Error(`Module ${name} is already registered`);
    }

    const moduleInfo = {
      name,
      instance,
      status: 'initializing',
      startedAt: null,
      lastHealthCheck: null,
      healthStatus: 'unknown',
      errors: []
    };

    this.modules.set(name, moduleInfo);
    this.restartAttempts.set(name, 0);

    // بدء الوحدة بعد دورة event loop للتأكد من اكتمال التهيئة
    Promise.resolve().then(() => this.startModule(name));
    
    // بدء فحص الصحة إذا لم يكن مفعلاً
    if (!this.healthCheckTimer) {
      this.startHealthChecks();
    }

    this.messageBus.emit('lifecycle.moduleRegistered', { name });
  }

  /**
   * إلغاء تسجيل وحدة
   */
  async unregisterModule(name) {
    const moduleInfo = this.modules.get(name);
    if (!moduleInfo) {
      throw new Error(`Module ${name} is not registered`);
    }

    // إيقاف الوحدة
    await this.stopModule(name);
    
    // إزالة من القوائم
    this.modules.delete(name);
    this.healthChecks.delete(name);
    this.restartAttempts.delete(name);

    this.messageBus.emit('lifecycle.moduleUnregistered', { name });
  }

  /**
   * بدء وحدة
   */
  async startModule(name) {
    const moduleInfo = this.modules.get(name);
    if (!moduleInfo) return;

    try {
      moduleInfo.status = 'starting';
      
      // استدعاء start إذا كانت موجودة
      if (typeof moduleInfo.instance.start === 'function') {
        await moduleInfo.instance.start();
      }
      
      moduleInfo.status = 'running';
      moduleInfo.startedAt = Date.now();
      moduleInfo.healthStatus = 'healthy';
      
      this.messageBus.emit('lifecycle.moduleStarted', { name });
      
    } catch (error) {
      moduleInfo.status = 'error';
      moduleInfo.errors.push({
        type: 'start',
        message: error.message,
        timestamp: Date.now()
      });
      
      this.messageBus.emit('lifecycle.moduleError', {
        name,
        error: error.message,
        type: 'start'
      });
      
      // محاولة إعادة التشغيل
      this.attemptRestart(name);
    }
  }

  /**
   * إيقاف وحدة
   */
  async stopModule(name) {
    const moduleInfo = this.modules.get(name);
    if (!moduleInfo) return;

    try {
      moduleInfo.status = 'stopping';
      
      // استدعاء stop إذا كانت موجودة
      if (typeof moduleInfo.instance.stop === 'function') {
        await this.withTimeout(
          moduleInfo.instance.stop(),
          this.config.gracefulShutdownTimeout
        );
      }
      
      moduleInfo.status = 'stopped';
      moduleInfo.healthStatus = 'stopped';
      
      this.messageBus.emit('lifecycle.moduleStopped', { name });
      
    } catch (error) {
      moduleInfo.errors.push({
        type: 'stop',
        message: error.message,
        timestamp: Date.now()
      });
      
      // Force stop
      moduleInfo.status = 'stopped';
      
      this.messageBus.emit('lifecycle.moduleError', {
        name,
        error: error.message,
        type: 'stop'
      });
    }
  }

  /**
   * محاولة إعادة تشغيل وحدة
   */
  async attemptRestart(name) {
    const attempts = this.restartAttempts.get(name) || 0;
    
    if (attempts >= this.config.maxRestartAttempts) {
      const moduleInfo = this.modules.get(name);
      if (moduleInfo) {
        moduleInfo.status = 'failed';
        moduleInfo.healthStatus = 'critical';
      }
      
      this.messageBus.emit('lifecycle.moduleFailed', {
        name,
        attempts,
        reason: 'Max restart attempts reached'
      });
      return;
    }

    this.restartAttempts.set(name, attempts + 1);
    
    setTimeout(async () => {
      console.log(`Attempting to restart module ${name} (attempt ${attempts + 1})`);
      await this.startModule(name);
    }, this.config.restartDelay);
  }

  /**
   * بدء فحوصات الصحة
   */
  startHealthChecks() {
    if (this.healthCheckTimer) return;
    
    this.healthCheckTimer = setInterval(() => {
      this.performHealthChecks();
    }, this.config.healthCheckInterval);
  }

  /**
   * إيقاف فحوصات الصحة
   */
  stopHealthChecks() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  /**
   * إجراء فحوصات الصحة
   */
  async performHealthChecks() {
    if (this.isShuttingDown) return;
    
    for (const [name, moduleInfo] of this.modules) {
      if (moduleInfo.status !== 'running') continue;
      
      try {
        let isHealthy = true;
        
        // فحص صحة مخصص
        if (typeof moduleInfo.instance.healthCheck === 'function') {
          isHealthy = await moduleInfo.instance.healthCheck();
        }
        
        moduleInfo.lastHealthCheck = Date.now();
        moduleInfo.healthStatus = isHealthy ? 'healthy' : 'unhealthy';
        
        if (!isHealthy) {
          this.messageBus.emit('lifecycle.moduleUnhealthy', { name });
          
          // إعادة تشغيل إذا كانت غير صحية
          if (moduleInfo.instance.autoRestart !== false) {
            await this.stopModule(name);
            await this.attemptRestart(name);
          }
        }
        
      } catch (error) {
        moduleInfo.healthStatus = 'error';
        moduleInfo.errors.push({
          type: 'healthCheck',
          message: error.message,
          timestamp: Date.now()
        });
        
        this.messageBus.emit('lifecycle.healthCheckError', {
          name,
          error: error.message
        });
      }
    }
  }

  /**
   * الحصول على حالة النظام
   */
  getSystemStatus() {
    const modules = {};
    
    for (const [name, info] of this.modules) {
      modules[name] = {
        status: info.status,
        healthStatus: info.healthStatus,
        startedAt: info.startedAt,
        lastHealthCheck: info.lastHealthCheck,
        errorCount: info.errors.length,
        restartAttempts: this.restartAttempts.get(name) || 0
      };
    }
    
    return {
      isShuttingDown: this.isShuttingDown,
      moduleCount: this.modules.size,
      healthyModules: Array.from(this.modules.values())
        .filter(m => m.healthStatus === 'healthy').length,
      modules
    };
  }

  /**
   * إيقاف النظام بالكامل
   */
  async shutdown() {
    if (this.isShuttingDown) return;
    
    console.log('Initiating system shutdown...');
    this.isShuttingDown = true;
    
    // إيقاف فحوصات الصحة
    this.stopHealthChecks();
    
    // إيقاف جميع الوحدات بالترتيب العكسي
    const moduleNames = Array.from(this.modules.keys()).reverse();
    
    for (const name of moduleNames) {
      try {
        await this.stopModule(name);
      } catch (error) {
        console.error(`Error stopping module ${name}:`, error);
      }
    }
    
    this.messageBus.emit('lifecycle.systemShutdown', {
      timestamp: Date.now()
    });
    
    console.log('System shutdown complete');
  }

  /**
   * وظيفة مساعدة للـ timeout
   */
  async withTimeout(promise, timeout) {
    const timeoutPromise = new Promise((_, reject) => {
      setTimeout(() => reject(new Error('Operation timed out')), timeout);
    });
    
    return Promise.race([promise, timeoutPromise]);
  }

  /**
   * تنظيف
   */
  cleanup() {
    this.stopHealthChecks();
    this.modules.clear();
    this.healthChecks.clear();
    this.restartAttempts.clear();
  }
}
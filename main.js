/**
 * TyrexCad Main Entry Point - FIXED
 * 
 * نسخة مبسطة وصحيحة
 */

import { MessageBus } from './core/message-bus.js';
import { ModuleLoader } from './core/module-loader.js';
import { LifecycleManager } from './core/lifecycle.js';

// استيراد الوحدات الموجودة فعلاً
import EchoModule from './modules/echo/index.js';
import CounterModule from './modules/counter/index.js';
import StorageModule from './modules/storage/index.js';
import ResourcesModule from './modules/resources/index.js';
import ShellModule from './modules/shell/index.js';
import DesktopFeaturesModule from './modules/desktop-features/index.js';

async function initializeTyrexCad() {
  try {
    console.log('🚀 Starting TyrexCad...');
    
    // 1. إنشاء النظام الأساسي بإعدادات بسيطة
    const messageBus = new MessageBus({
      enableLogging: import.meta.env.DEV,
      enablePriorityQueue: false, // نبدأ بسيط
      productionMode: import.meta.env.PROD
    });
    
    // 2. إنشاء مدير دورة الحياة
    const lifecycle = new LifecycleManager(messageBus);
    
    // 3. إنشاء محمل الوحدات
    const moduleLoader = new ModuleLoader(messageBus, lifecycle);
    
    // 4. تسجيل الوحدات الموجودة
    moduleLoader.registerModuleType('echo', EchoModule);
    moduleLoader.registerModuleType('counter', CounterModule);
    moduleLoader.registerModuleType('storage', StorageModule);
    moduleLoader.registerModuleType('resources', ResourcesModule);
    moduleLoader.registerModuleType('shell', ShellModule);
    moduleLoader.registerModuleType('desktop-features', DesktopFeaturesModule);
    
    // 5. تحميل الوحدات الأساسية
    console.log('📦 Loading core modules...');
    
    // Storage أولاً - مطلوب للوحدات الأخرى
    await moduleLoader.loadModule('storage');
    
    // Resources بعد Storage
    await moduleLoader.loadModule('resources');
    
    // Shell UI
    await moduleLoader.loadModule('shell');
    
    // Desktop features إذا كان متاحاً
    await moduleLoader.loadModule('desktop-features');
    
    // وحدات demo للاختبار
    if (import.meta.env.DEV) {
      await moduleLoader.loadModule('echo');
      await moduleLoader.loadModule('counter');
    }
    
    // 6. إخفاء شاشة التحميل
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
      loadingEl.style.display = 'none';
    }
    
    // 7. بث رسالة أن النظام جاهز
    messageBus.emit('system.ready', {
      timestamp: Date.now(),
      modules: moduleLoader.getLoadedModules(),
      mode: import.meta.env.PROD ? 'production' : 'development'
    });
    
    console.log('✅ TyrexCad initialized successfully!');
    
    // في وضع التطوير، نضع helper للاختبار
    if (import.meta.env.DEV) {
      window.__tyrexcad = {
        messageBus,
        lifecycle,
        moduleLoader,
        // اختصارات مفيدة
        emit: (event, data) => messageBus.emit(event, data),
        on: (event, handler) => messageBus.on(event, handler),
        request: (event, data) => messageBus.request(event, data),
        getStats: () => messageBus.getStats(),
        loadedModules: () => moduleLoader.getLoadedModules()
      };
      
      console.log('💡 Dev mode: Use window.__tyrexcad');
    }
    
    // معالجة إيقاف التطبيق
    window.addEventListener('beforeunload', () => {
      lifecycle.shutdown();
      messageBus.destroy();
    });
    
  } catch (error) {
    console.error('❌ Failed to initialize TyrexCad:', error);
    
    // عرض الخطأ للمستخدم
    const loadingEl = document.getElementById('loading');
    if (loadingEl) {
      loadingEl.innerHTML = `
        <div style="color: #ff4444;">
          <h2>Initialization Failed</h2>
          <p>${error.message}</p>
        </div>
      `;
    }
  }
}

// بدء التطبيق
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTyrexCad);
} else {
  initializeTyrexCad();
}
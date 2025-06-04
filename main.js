/**
 * TyrexCad Main Entry Point
 * 
 * هذا الملف الوحيد الذي يُسمح له بتحميل الـ core
 * كل شيء آخر يتواصل عبر الرسائل فقط!
 */

import { MessageBus } from './core/message-bus.js';
import { ModuleLoader } from './core/module-loader.js';
import { LifecycleManager } from './core/lifecycle.js';

// تهيئة النظام
async function initializeTyrexCad() {
  try {
    console.log('🚀 Starting TyrexCad initialization...');
    
    // 1. إنشاء ناقل الرسائل المركزي
    const messageBus = new MessageBus();
    
    // 2. إنشاء مدير دورة الحياة
    const lifecycle = new LifecycleManager(messageBus);
    
    // 3. إنشاء محمل الوحدات
    const moduleLoader = new ModuleLoader(messageBus, lifecycle);
    
    // 4. تحميل الوحدات الأساسية بالترتيب الصحيح
    const coreModules = [
      'geometry',    // إدارة الأشكال الهندسية
      'viewport',    // العرض ثلاثي الأبعاد
      'state',       // إدارة حالة التطبيق
      // سنضيف المزيد لاحقاً
    ];
    
    console.log('📦 Loading core modules...');
    for (const moduleName of coreModules) {
      await moduleLoader.loadModule(moduleName);
    }
    
    // 5. إخفاء شاشة التحميل
    document.getElementById('loading').style.display = 'none';
    
    // 6. بث رسالة أن النظام جاهز
    messageBus.emit('system.ready', {
      timestamp: Date.now(),
      modules: coreModules
    });
    
    console.log('✅ TyrexCad initialized successfully!');
    
    // حفظ المراجع في window للتطوير فقط (سيُزال في الإنتاج)
    if (import.meta.env.DEV) {
      window.__tyrexcad = {
        messageBus,
        lifecycle,
        moduleLoader,
        // للاختبار اليدوي في console
        emit: (event, data) => messageBus.emit(event, data),
        on: (event, handler) => messageBus.on(event, handler),
      };
    }
    
  } catch (error) {
    console.error('❌ Failed to initialize TyrexCad:', error);
    document.getElementById('loading').innerHTML = `
      <div style="color: #ff4444;">
        <h2>Initialization Failed</h2>
        <p>${error.message}</p>
      </div>
    `;
  }
}

// بدء التهيئة عند تحميل الصفحة
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeTyrexCad);
} else {
  initializeTyrexCad();
}
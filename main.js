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
    
    // 1. إنشاء ناقل الرسائل المركزي مع إعدادات الإنتاج
    const messageBusConfig = import.meta.env.PROD 
      ? MessageBus.getProductionConfig()
      : {
          // إعدادات التطوير - أقل صرامة للسماح بالتجريب
          maxQueueSize: 10000,
          batchSize: 100,
          enableLogging: true,
          productionMode: false,
          enableBackpressure: true,
          backpressureThreshold: 0.8
        };
    
    const messageBus = new MessageBus(messageBusConfig);
    
    // في وضع التطوير، نظهر إحصائيات الأداء
    if (import.meta.env.DEV) {
      setInterval(() => {
        const stats = messageBus.getStats();
        console.log('📊 Message Bus Health:', {
          health: stats.health + '%',
          messagesPerSecond: stats.messagesPerSecond,
          queueSizes: stats.queueSizes,
          pressure: stats.pressure.level
        });
      }, 10000); // كل 10 ثواني
    }
    
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
      modules: coreModules,
      mode: import.meta.env.PROD ? 'production' : 'development'
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
        request: (event, data) => messageBus.request(event, data),
        getStats: () => messageBus.getStats()
      };
      
      console.log('💡 Development mode: Access TyrexCad via window.__tyrexcad');
    }
    
    // معالجة أخطاء النظام
    messageBus.on('system.error', (message) => {
      console.error('System Error:', message.data);
      
      // في الإنتاج، يمكن إرسال الأخطاء لخدمة monitoring
      if (import.meta.env.PROD) {
        // TODO: Send to error monitoring service
      }
    });
    
    // مراقبة الأداء
    messageBus.on('system.metrics.*', (message) => {
      if (import.meta.env.DEV) {
        console.debug('Performance metric:', message.data);
      }
    });
    
    // معالجة إيقاف التطبيق بشكل آمن
    window.addEventListener('beforeunload', () => {
      console.log('🛑 Shutting down TyrexCad...');
      messageBus.emit('system.shutdown', {}, { priority: 'high' });
      messageBus.destroy();
    });
    
  } catch (error) {
    console.error('❌ Failed to initialize TyrexCad:', error);
    document.getElementById('loading').innerHTML = `
      <div style="color: #ff4444;">
        <h2>Initialization Failed</h2>
        <p>${error.message}</p>
        <details style="margin-top: 20px;">
          <summary>Technical Details</summary>
          <pre style="text-align: left; font-size: 12px;">${error.stack}</pre>
        </details>
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
/**
 * Basic Demo - اختبار أساسي للنظام
 * 
 * هذا demo فقط - في الإنتاج، الوحدات تُحمل عند الطلب
 */

import { MessageBus } from '../core/message-bus.js';
import { ModuleLoader } from '../core/module-loader.js';
import { LifecycleManager } from '../core/lifecycle.js';

async function runDemo() {
  console.log('🚀 Starting TyrexCad Basic Demo\n');
  
  // 1. إنشاء النظام الأساسي
  const messageBus = new MessageBus({ enableLogging: true });
  const lifecycle = new LifecycleManager(messageBus);
  const moduleLoader = new ModuleLoader(messageBus, lifecycle);
  
  // 2. للـ demo فقط: تحميل وحدات الاختبار
  console.log('📦 Loading demo modules...');
  
  // Echo Module
  const EchoModule = (await import('../modules/echo/index.js')).default;
  moduleLoader.registerModuleType('echo', EchoModule);
  await moduleLoader.loadModule('echo');
  
  // Counter Module
  const CounterModule = (await import('../modules/counter/index.js')).default;
  moduleLoader.registerModuleType('counter', CounterModule);
  await moduleLoader.loadModule('counter');
  
  console.log('✅ Modules loaded successfully\n');
  
  // 3. اختبار Echo Module
  console.log('🔊 Testing Echo Module:');
  const echoResponse = await messageBus.request('echo.request', {
    message: 'Hello TyrexCad!'
  });
  console.log('Echo response:', echoResponse);
  
  // 4. اختبار Counter Module
  console.log('\n🔢 Testing Counter Module:');
  
  // إنشاء عداد
  await messageBus.request('counter.create', {
    name: 'clicks',
    initialValue: 0
  });
  console.log('Created counter: clicks');
  
  // زيادة العداد
  const inc1 = await messageBus.request('counter.increment', {
    name: 'clicks',
    amount: 5
  });
  console.log('After increment by 5:', inc1);
  
  // إنقاص العداد
  const dec1 = await messageBus.request('counter.decrement', {
    name: 'clicks',
    amount: 2
  });
  console.log('After decrement by 2:', dec1);
  
  // الإحصائيات
  const stats = await messageBus.request('counter.stats', {});
  console.log('Counter module stats:', stats);
  
  // 5. عرض حالة النظام
  console.log('\n📊 System Status:');
  const systemStatus = await messageBus.request('lifecycle.status', {});
  console.log(JSON.stringify(systemStatus, null, 2));
  
  // 6. إيقاف النظام
  console.log('\n🛑 Shutting down...');
  await lifecycle.shutdown();
  messageBus.destroy();
  
  console.log('✅ Demo completed successfully!');
}

// تشغيل الـ demo
runDemo().catch(console.error);
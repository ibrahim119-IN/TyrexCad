/**
 * Message Bus Demo
 * 
 * هذا السكريبت يوضح كيفية عمل Message Bus بأمثلة عملية
 * شغله باستخدام: node scripts/demo-message-bus.js
 */

import { MessageBus, createMessageAPI } from '../core/message-bus.js';

console.log('🚀 Message Bus Demo\n');

// إنشاء Message Bus مع إعدادات مخصصة للعرض
const messageBus = new MessageBus({
  enableLogging: true,
  maxDataSize: 1024 * 512, // 512KB للعرض التوضيحي
  warnDataSize: 1024 * 100 // 100KB للتحذير
});

console.log('📊 Initial System Health:', messageBus.getStats().health + '%\n');

// ========================================
// مثال 1: النشر والاشتراك البسيط
// ========================================
console.log('📍 Example 1: Simple Publish/Subscribe\n');

// وحدة الهندسة تستمع للأوامر
messageBus.on('geometry.create', (message) => {
  console.log('📐 Geometry Module received:', message.data);
  
  // بعد إنشاء الشكل، نرسل حدث للإعلام
  messageBus.emit('geometry.created', {
    id: 'shape_' + Math.random().toString(36).substr(2, 9),
    type: message.data.type,
    dimensions: message.data.dimensions
  });
});

// وحدة العرض تستمع لأحداث الهندسة
messageBus.on('geometry.created', (message) => {
  console.log('🖼️  Viewport Module will render:', message.data);
});

// إرسال أمر إنشاء شكل
messageBus.emit('geometry.create', {
  type: 'box',
  dimensions: { width: 100, height: 50, depth: 75 }
});

// ========================================
// مثال 2: استخدام Wildcard Patterns
// ========================================
console.log('\n📍 Example 2: Wildcard Patterns\n');

// وحدة السجلات تستمع لكل الأحداث
let eventCount = 0;
messageBus.on('*', (message) => {
  eventCount++;
  console.log(`📝 Logger: Event #${eventCount} - ${message.event}`);
});

// وحدة الأدوات تستمع لكل أحداث الأدوات
messageBus.on('tool.*', (message) => {
  console.log('🔧 Tool Manager:', message.event, message.data);
});

// تفعيل أدوات مختلفة
messageBus.emit('tool.line.activated', { cursor: 'crosshair' });
messageBus.emit('tool.box.activated', { preview: true });
messageBus.emit('viewport.zoom', { level: 2 }); // هذا لن يصل لـ tool manager

// ========================================
// مثال 3: Request/Response Pattern
// ========================================
console.log('\n📍 Example 3: Request/Response\n');

// وحدة الحسابات تستمع للطلبات
messageBus.on('calculate.area', async (message) => {
  const { shape } = message.data;
  let area;
  
  // محاكاة عملية حسابية تأخذ وقت
  await new Promise(resolve => setTimeout(resolve, 100));
  
  if (shape.type === 'rectangle') {
    area = shape.width * shape.height;
  } else if (shape.type === 'circle') {
    area = Math.PI * shape.radius ** 2;
  }
  
  // الرد على الطلب
  messageBus.reply(message.requestId, {
    success: true,
    result: { area: area.toFixed(2), unit: 'mm²' }
  });
});

// إرسال طلب حساب المساحة
async function calculateAreas() {
  try {
    console.log('📊 Calculating rectangle area...');
    const rectArea = await messageBus.request('calculate.area', {
      shape: { type: 'rectangle', width: 100, height: 50 }
    });
    console.log('✅ Rectangle area:', rectArea);
    
    console.log('\n📊 Calculating circle area...');
    const circleArea = await messageBus.request('calculate.area', {
      shape: { type: 'circle', radius: 25 }
    });
    console.log('✅ Circle area:', circleArea);
    
  } catch (error) {
    console.error('❌ Calculation failed:', error.message);
  }
}

// ========================================
// مثال 4: محاكاة وحدات حقيقية
// ========================================
console.log('\n📍 Example 4: Simulating Real Modules\n');

// إنشاء APIs منفصلة لكل وحدة (كما سيحدث في النظام الحقيقي)
const geometryAPI = createMessageAPI(messageBus, 'GeometryModule');
const viewportAPI = createMessageAPI(messageBus, 'ViewportModule');
const toolAPI = createMessageAPI(messageBus, 'ToolModule');

// الوحدات تتواصل عبر APIs الخاصة بها
geometryAPI.on('geometry.transform', (msg) => {
  console.log('🔄 GeometryModule: Transforming shape', msg.data);
  geometryAPI.emit('geometry.transformed', {
    id: msg.data.id,
    transform: msg.data.transform
  });
});

viewportAPI.on('geometry.transformed', (msg) => {
  console.log('🎨 ViewportModule: Updating display for', msg.data.id);
});

// أداة التحريك ترسل أمر التحويل
toolAPI.emit('geometry.transform', {
  id: 'shape_abc123',
  transform: { translate: { x: 50, y: 0, z: 0 } }
});

// ========================================
// مثال 5: معالجة الأخطاء
// ========================================
console.log('\n📍 Example 5: Error Handling\n');

// مستمع يسبب خطأ
messageBus.on('buggy.operation', () => {
  throw new Error('Oops! Something went wrong');
});

// مستمع آخر على نفس الحدث
messageBus.on('buggy.operation', () => {
  console.log('✅ This handler still works!');
});

// مستمع لأخطاء النظام
messageBus.on('system.error', (message) => {
  console.log('🚨 System Error Caught:', {
    originalEvent: message.data.originalEvent,
    error: message.data.error
  });
});

// إرسال الحدث الذي يسبب خطأ
messageBus.emit('buggy.operation', {});

// ========================================
// مثال 6: اختبار نظام الأولويات الجديد
// ========================================
console.log('\n📍 Example 6: Priority System\n');

// مراقب لترتيب الرسائل
const messageOrder = [];
messageBus.on('priority.*', (msg) => {
  messageOrder.push(`${msg.data.name} (${msg.priority})`);
  console.log(`⚡ Processed: ${msg.data.name} with ${msg.priority} priority`);
});

// إرسال رسائل بأولويات مختلفة
console.log('Sending messages in mixed order...');
messageBus.emit('priority.test', { name: 'Task 1' }, { priority: 'low' });
messageBus.emit('priority.test', { name: 'URGENT' }, { priority: 'high' });
messageBus.emit('priority.test', { name: 'Task 2' }, { priority: 'normal' });
messageBus.emit('priority.test', { name: 'CRITICAL' }, { priority: 'high' });

// ========================================
// مثال 7: حماية من البيانات الكبيرة
// ========================================
console.log('\n📍 Example 7: Data Size Protection\n');

// محاولة إرسال بيانات كبيرة
try {
  const largeData = { 
    content: 'x'.repeat(1024 * 600), // 600KB
    description: 'This is too large!' 
  };
  messageBus.emit('large.data', largeData);
} catch (error) {
  console.log('❌ Large data rejected:', error.message);
}

// إرسال بيانات متوسطة (ستظهر تحذير)
const mediumData = { 
  content: 'y'.repeat(1024 * 150), // 150KB
  description: 'This will trigger a warning' 
};
messageBus.emit('medium.data', mediumData);

// ========================================
// مثال 8: مراقبة صحة النظام
// ========================================
console.log('\n📍 Example 8: System Health Monitoring\n');

// محاكاة بعض الأخطاء
messageBus.on('simulate.errors', () => {
  if (Math.random() > 0.5) {
    throw new Error('Random failure');
  }
});

// إرسال رسائل لتوليد أخطاء
for (let i = 0; i < 10; i++) {
  messageBus.emit('simulate.errors', { attempt: i });
}

// محاكاة طلبات بطيئة
messageBus.on('slow.operation', async (msg) => {
  await new Promise(resolve => setTimeout(resolve, 200));
  messageBus.reply(msg.requestId, { success: true, result: 'Finally done!' });
});

// ========================================
// مثال 9: حماية من تكرار التسجيل
// ========================================
console.log('\n📍 Example 9: Duplicate Handler Protection\n');

const duplicateHandler = (msg) => {
  console.log('🔄 Duplicate handler called');
};

// محاولة تسجيل نفس handler مرتين
messageBus.on('duplicate.test', duplicateHandler);
messageBus.on('duplicate.test', duplicateHandler); // سيظهر تحذير

messageBus.emit('duplicate.test', {});

// ========================================
// مثال 10: اختبار النظام تحت الضغط
// ========================================
console.log('\n📍 Example 10: System Under Pressure\n');

// محاكاة ضغط على النظام
console.log('🔥 Simulating high pressure scenario...');

// إرسال 1000 رسالة بسرعة
for (let i = 0; i < 1000; i++) {
  const priority = i < 50 ? 'high' : i < 200 ? 'normal' : 'low';
  messageBus.emit('pressure.test', { 
    id: i,
    size: 'x'.repeat(100) // payload صغير
  }, { priority });
}

// عرض حالة النظام تحت الضغط
setTimeout(() => {
  const pressureStats = messageBus.getStats();
  console.log('\n📊 System Under Pressure:');
  console.log(`   Queue sizes: High=${pressureStats.queueSizes.high}, Normal=${pressureStats.queueSizes.normal}, Low=${pressureStats.queueSizes.low}`);
  console.log(`   Pressure level: ${pressureStats.pressure.level}`);
  console.log(`   Messages dropped: ${pressureStats.pressure.dropped}`);
  console.log(`   Processing rate: ${pressureStats.processingRate} msg/s`);
  console.log(`   System health: ${pressureStats.health}%`);
}, 100);

// ========================================
// تشغيل الأمثلة غير المتزامنة والإحصائيات المحسنة
// ========================================
setTimeout(async () => {
  await calculateAreas();
  
  // إرسال طلب بطيء
  console.log('\n📊 Testing slow request warning...');
  try {
    await messageBus.request('slow.operation', {}, 300);
    console.log('✅ Slow operation completed (close to timeout)');
  } catch (error) {
    console.error('❌ Slow operation failed:', error.message);
  }
  
  // عرض الإحصائيات النهائية المحسنة
  console.log('\n📊 Enhanced Final Statistics:');
  const stats = messageBus.getStats();
  console.log(`   System Health: ${stats.health}%`);
  console.log(`   Uptime: ${stats.uptimeHuman}`);
  console.log(`   Messages sent: ${stats.messagesSent}`);
  console.log(`   Messages received: ${stats.messagesReceived}`);
  console.log(`   Messages dropped: ${stats.messagesDropped}`);
  console.log(`   Drop rate: ${stats.performance.dropRate}`);
  console.log(`   Large message warnings: ${stats.largeMessagesWarnings}`);
  console.log(`   Errors caught: ${stats.errorsCaught}`);
  console.log(`   Request success rate: ${stats.performance.requestSuccessRate}`);
  console.log(`   Processing rate: ${stats.processingRate} msg/s`);
  console.log(`   Peak listeners: ${stats.peakListeners}`);
  console.log(`   Peak pending requests: ${stats.peakPendingRequests}`);
  console.log(`   Messages per second: ${stats.messagesPerSecond}`);
  console.log(`   Queue utilization: ${stats.performance.queueUtilization}`);
  console.log(`   Final pressure: ${stats.pressure.level}`);
  console.log(`   Final queue sizes:`, stats.queueSizes);
  
  // تنظيف
  messageBus.destroy();
  process.exit(0);
}, 500);
/**
 * Message Bus Stress Test Demo
 * 
 * يختبر قدرة Message Bus على التعامل مع آلاف الرسائل
 * شغله باستخدام: node scripts/stress-test-message-bus.js
 */

import { MessageBus } from '../core/message-bus.js';

console.log('🚀 Message Bus Stress Test\n');

// إنشاء Message Bus مع إعدادات للضغط العالي
const messageBus = new MessageBus({
  enableLogging: false, // إيقاف السجلات لتحسين الأداء
  maxQueueSize: 5000,
  enableBackpressure: true,
  backpressureThreshold: 0.7,
  dropPolicy: 'low-priority',
  batchSize: 200,
  maxProcessingTime: 16, // 16ms = 60fps
});

// متغيرات لتتبع الأداء
const stats = {
  sent: 0,
  received: 0,
  errors: 0,
  startTime: Date.now(),
  messageTypes: new Map(),
  latencies: [],
  priorities: { high: 0, normal: 0, low: 0 }
};

// ========================================
// تجهيز المستمعين
// ========================================

// مستمع لحساب الإحصائيات
messageBus.on('*', (message) => {
  stats.received++;
  
  // حساب التأخير
  if (message.data && message.data.sentAt) {
    const latency = Date.now() - message.data.sentAt;
    stats.latencies.push(latency);
  }
  
  // تتبع الأولويات
  if (message.priority) {
    stats.priorities[message.priority]++;
  }
});

// مستمعون متخصصون لأنواع مختلفة
messageBus.on('compute.*', (message) => {
  // محاكاة عملية حسابية
  const result = Math.sqrt(message.data.value) * Math.PI;
  
  // إذا كان طلب، أرسل الرد
  if (message.requestId) {
    messageBus.reply(message.requestId, {
      success: true,
      result: result
    });
  }
});

messageBus.on('io.*', async (message) => {
  // محاكاة عملية I/O بطيئة
  await new Promise(resolve => setTimeout(resolve, Math.random() * 10));
  
  if (message.requestId) {
    messageBus.reply(message.requestId, {
      success: true,
      result: 'IO completed'
    });
  }
});

messageBus.on('critical.*', (message) => {
  // معالجة الرسائل الحرجة فوراً
  stats.messageTypes.set('critical', (stats.messageTypes.get('critical') || 0) + 1);
});

// ========================================
// سيناريوهات الضغط
// ========================================

console.log('📊 Starting stress scenarios...\n');

// السيناريو 1: وابل من الرسائل
async function scenario1() {
  console.log('🌊 Scenario 1: Message Burst (10,000 messages in 1 second)');
  const start = Date.now();
  
  for (let i = 0; i < 10000; i++) {
    const priority = i % 100 === 0 ? 'high' : i % 20 === 0 ? 'normal' : 'low';
    messageBus.emit(`compute.task${i % 10}`, {
      value: i,
      sentAt: Date.now()
    }, { priority });
    stats.sent++;
  }
  
  const burstTime = Date.now() - start;
  console.log(`   ✓ Sent in ${burstTime}ms (${(10000 / (burstTime / 1000)).toFixed(0)} msg/s)`);
  
  // انتظار المعالجة
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const busStats = messageBus.getStats();
  console.log(`   ✓ Processed: ${stats.received}`);
  console.log(`   ✓ Dropped: ${busStats.messagesDropped}`);
  console.log(`   ✓ Pressure: ${busStats.pressure.level}`);
  console.log(`   ✓ Queue sizes:`, busStats.queueSizes);
}

// السيناريو 2: ضغط مستمر
async function scenario2() {
  console.log('\n🔥 Scenario 2: Sustained Pressure (1000 msg/s for 5 seconds)');
  
  const interval = setInterval(() => {
    for (let i = 0; i < 100; i++) {
      messageBus.emit(`io.operation${i}`, {
        data: 'x'.repeat(1000), // 1KB payload
        sentAt: Date.now()
      });
      stats.sent++;
    }
  }, 100); // 100 رسالة كل 100ms = 1000/ثانية
  
  await new Promise(resolve => setTimeout(resolve, 5000));
  clearInterval(interval);
  
  const busStats = messageBus.getStats();
  console.log(`   ✓ Total sent: ${stats.sent}`);
  console.log(`   ✓ Processing rate: ${busStats.processingRate} msg/s`);
  console.log(`   ✓ Drop rate: ${busStats.performance.dropRate}`);
  console.log(`   ✓ Health: ${busStats.health}%`);
}

// السيناريو 3: أولويات مختلطة
async function scenario3() {
  console.log('\n⚡ Scenario 3: Mixed Priorities Under Pressure');
  
  let criticalSent = 0;
  let normalSent = 0;
  let lowSent = 0;
  
  // إرسال رسائل بأولويات مختلفة
  for (let i = 0; i < 5000; i++) {
    if (i % 50 === 0) {
      // رسائل حرجة
      messageBus.emit('critical.alert', {
        id: i,
        severity: 'high',
        sentAt: Date.now()
      }, { priority: 'high' });
      criticalSent++;
    } else if (i % 10 === 0) {
      // رسائل عادية
      messageBus.emit('compute.normal', {
        id: i,
        sentAt: Date.now()
      }, { priority: 'normal' });
      normalSent++;
    } else {
      // رسائل منخفضة الأولوية
      messageBus.emit('io.background', {
        id: i,
        sentAt: Date.now()
      }, { priority: 'low' });
      lowSent++;
    }
    stats.sent++;
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(`   ✓ Sent: Critical=${criticalSent}, Normal=${normalSent}, Low=${lowSent}`);
  console.log(`   ✓ Received by priority:`, stats.priorities);
  
  // حساب معدل النجاح لكل أولوية
  const criticalSuccess = (stats.messageTypes.get('critical') || 0) / criticalSent * 100;
  console.log(`   ✓ Critical message success rate: ${criticalSuccess.toFixed(1)}%`);
}

// السيناريو 4: طلبات متزامنة
async function scenario4() {
  console.log('\n🔄 Scenario 4: Concurrent Requests');
  
  const requests = [];
  const requestStart = Date.now();
  
  // إرسال 1000 طلب متزامن
  for (let i = 0; i < 1000; i++) {
    requests.push(
      messageBus.request(`compute.fibonacci`, {
        n: 20 + (i % 10),
        sentAt: Date.now()
      }, 1000).catch(() => null)
    );
  }
  
  const results = await Promise.all(requests);
  const successCount = results.filter(r => r !== null).length;
  const requestTime = Date.now() - requestStart;
  
  console.log(`   ✓ Successful requests: ${successCount}/1000`);
  console.log(`   ✓ Total time: ${requestTime}ms`);
  console.log(`   ✓ Requests/second: ${(1000 / (requestTime / 1000)).toFixed(0)}`);
}

// ========================================
// تشغيل السيناريوهات وعرض النتائج
// ========================================

async function runStressTest() {
  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();
  
  // حساب الإحصائيات النهائية
  console.log('\n📈 Final Statistics:');
  
  const duration = Date.now() - stats.startTime;
  const avgLatency = stats.latencies.length > 0 
    ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length 
    : 0;
  const p95Latency = stats.latencies.length > 0
    ? stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.95)]
    : 0;
  
  const finalStats = messageBus.getStats();
  
  console.log(`   Total duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(`   Messages sent: ${stats.sent}`);
  console.log(`   Messages received: ${stats.received}`);
  console.log(`   Messages dropped: ${finalStats.messagesDropped}`);
  console.log(`   Success rate: ${(stats.received / stats.sent * 100).toFixed(2)}%`);
  console.log(`   Average throughput: ${(stats.received / (duration / 1000)).toFixed(0)} msg/s`);
  console.log(`   Average latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`   P95 latency: ${p95Latency}ms`);
  console.log(`   Peak listeners: ${finalStats.peakListeners}`);
  console.log(`   Peak pending requests: ${finalStats.peakPendingRequests}`);
  console.log(`   Final health: ${finalStats.health}%`);
  
  // تحليل الأداء
  console.log('\n🎯 Performance Analysis:');
  
  if (finalStats.health > 80) {
    console.log('   ✅ Excellent: System remained healthy under extreme load');
  } else if (finalStats.health > 60) {
    console.log('   ⚠️  Good: System handled load with some pressure');
  } else {
    console.log('   ❌ Poor: System struggled under load');
  }
  
  if (avgLatency < 50) {
    console.log('   ✅ Excellent latency: Very responsive');
  } else if (avgLatency < 200) {
    console.log('   ⚠️  Acceptable latency: Some delays noticed');
  } else {
    console.log('   ❌ High latency: Significant delays');
  }
  
  const dropRate = finalStats.messagesDropped / stats.sent * 100;
  if (dropRate < 1) {
    console.log('   ✅ Minimal drops: Very reliable delivery');
  } else if (dropRate < 5) {
    console.log('   ⚠️  Some drops: Mostly reliable with backpressure');
  } else {
    console.log('   ❌ High drop rate: Need to tune settings');
  }
  
  // تنظيف
  messageBus.destroy();
  process.exit(0);
}

// بدء الاختبار
runStressTest().catch(console.error);
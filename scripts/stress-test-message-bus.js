/**
 * Message Bus Production Stress Test
 * 
 * يختبر قدرة Message Bus المحسنة للإنتاج
 * شغله باستخدام: node scripts/stress-test-message-bus.js
 */

import { MessageBus } from '../core/message-bus.js';

console.log('🚀 Message Bus Production Stress Test\n');

// إنشاء Message Bus مع إعدادات الإنتاج
const productionConfig = MessageBus.getProductionConfig();
const messageBus = new MessageBus(productionConfig);

console.log('📋 Production Configuration:');
console.log(`   Max Queue Size: ${productionConfig.maxQueueSize.toLocaleString()}`);
console.log(`   Batch Size: ${productionConfig.batchSize}`);
console.log(`   Drop Policy: ${productionConfig.dropPolicy}`);
console.log(`   Backpressure Threshold: ${productionConfig.backpressureThreshold * 100}%`);
console.log('');

// متغيرات لتتبع الأداء
const stats = {
  sent: 0,
  received: 0,
  errors: 0,
  startTime: Date.now(),
  messageTypes: new Map(),
  latencies: [],
  priorities: { high: 0, normal: 0, low: 0 },
  criticalReceived: 0,
  criticalSent: 0
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
  stats.criticalReceived++;
  stats.messageTypes.set('critical', (stats.messageTypes.get('critical') || 0) + 1);
});

// ========================================
// سيناريوهات الضغط المحسنة للإنتاج
// ========================================

console.log('📊 Starting production stress scenarios...\n');

// السيناريو 1: وابل ضخم من الرسائل (محسن)
async function scenario1() {
  console.log('🌊 Scenario 1: Massive Message Burst (50,000 messages)');
  const start = Date.now();
  const messageCount = 50000; // زيادة من 10,000
  
  for (let i = 0; i < messageCount; i++) {
    const priority = i % 100 === 0 ? 'high' : i % 20 === 0 ? 'normal' : 'low';
    messageBus.emit(`compute.task${i % 10}`, {
      value: i,
      sentAt: Date.now()
    }, { priority });
    stats.sent++;
  }
  
  const burstTime = Date.now() - start;
  console.log(`   ✓ Sent in ${burstTime}ms (${(messageCount / (burstTime / 1000)).toFixed(0)} msg/s)`);
  
  // انتظار المعالجة
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  const busStats = messageBus.getStats();
  console.log(`   ✓ Processed: ${stats.received.toLocaleString()}`);
  console.log(`   ✓ Dropped: ${busStats.messagesDropped.toLocaleString()} (${((busStats.messagesDropped / messageCount) * 100).toFixed(1)}%)`);
  console.log(`   ✓ Pressure: ${busStats.pressure.level}`);
  console.log(`   ✓ Queue sizes:`, busStats.queueSizes);
  console.log(`   ✓ Health: ${busStats.health}%`);
}

// السيناريو 2: ضغط مستمر عالي جداً
async function scenario2() {
  console.log('\n🔥 Scenario 2: Extreme Sustained Pressure (5000 msg/s for 10 seconds)');
  
  let sentInScenario = 0;
  const interval = setInterval(() => {
    for (let i = 0; i < 500; i++) {
      messageBus.emit(`io.operation${i}`, {
        data: 'x'.repeat(1000), // 1KB payload
        sentAt: Date.now()
      });
      stats.sent++;
      sentInScenario++;
    }
  }, 100); // 500 رسالة كل 100ms = 5000/ثانية
  
  await new Promise(resolve => setTimeout(resolve, 10000));
  clearInterval(interval);
  
  const busStats = messageBus.getStats();
  console.log(`   ✓ Total sent: ${sentInScenario.toLocaleString()}`);
  console.log(`   ✓ Processing rate: ${busStats.processingRate} msg/s`);
  console.log(`   ✓ Drop rate: ${busStats.performance.dropRate}`);
  console.log(`   ✓ Health: ${busStats.health}%`);
  console.log(`   ✓ Adaptive multiplier: ${busStats.pressure.adaptiveMultiplier}`);
}

// السيناريو 3: أولويات مختلطة تحت ضغط شديد
async function scenario3() {
  console.log('\n⚡ Scenario 3: Priority System Under Extreme Load');
  
  stats.criticalSent = 0;
  stats.criticalReceived = 0;
  let normalSent = 0;
  let lowSent = 0;
  
  // إرسال رسائل بأولويات مختلفة
  for (let i = 0; i < 20000; i++) {
    if (i % 100 === 0) {
      // رسائل حرجة
      messageBus.emit('critical.alert', {
        id: i,
        severity: 'high',
        sentAt: Date.now()
      }, { priority: 'high' });
      stats.criticalSent++;
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
  
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  console.log(`   ✓ Sent: Critical=${stats.criticalSent}, Normal=${normalSent}, Low=${lowSent}`);
  console.log(`   ✓ Critical received: ${stats.criticalReceived}/${stats.criticalSent} (${(stats.criticalReceived/stats.criticalSent*100).toFixed(1)}%)`);
  console.log(`   ✓ Received by priority:`, stats.priorities);
  
  // التحقق من priorityBoost
  const criticalSuccessRate = (stats.criticalReceived / stats.criticalSent) * 100;
  if (criticalSuccessRate >= 99) {
    console.log(`   ✅ Priority boost working perfectly! All critical messages delivered.`);
  } else if (criticalSuccessRate >= 95) {
    console.log(`   ⚠️  Priority boost working well. ${criticalSuccessRate.toFixed(1)}% critical messages delivered.`);
  } else {
    console.log(`   ❌ Priority boost needs improvement. Only ${criticalSuccessRate.toFixed(1)}% critical messages delivered.`);
  }
}

// السيناريو 4: طلبات متزامنة ضخمة
async function scenario4() {
  console.log('\n🔄 Scenario 4: Massive Concurrent Requests (5000)');
  
  const requests = [];
  const requestStart = Date.now();
  const requestCount = 5000; // زيادة من 1000
  
  // إرسال طلبات متزامنة
  for (let i = 0; i < requestCount; i++) {
    requests.push(
      messageBus.request(`compute.fibonacci`, {
        n: 20 + (i % 10),
        sentAt: Date.now()
      }, 2000).catch(() => null)
    );
  }
  
  const results = await Promise.all(requests);
  const successCount = results.filter(r => r !== null).length;
  const requestTime = Date.now() - requestStart;
  
  console.log(`   ✓ Successful requests: ${successCount}/${requestCount} (${(successCount/requestCount*100).toFixed(1)}%)`);
  console.log(`   ✓ Total time: ${requestTime}ms`);
  console.log(`   ✓ Requests/second: ${(requestCount / (requestTime / 1000)).toFixed(0)}`);
}

// السيناريو 5: اختبار المعالجة التكيفية
async function scenario5() {
  console.log('\n🎯 Scenario 5: Adaptive Processing Test');
  
  // مراقبة تغيرات معامل التكيف
  const adaptiveHistory = [];
  const monitor = setInterval(() => {
    const stats = messageBus.getStats();
    adaptiveHistory.push({
      time: Date.now(),
      multiplier: parseFloat(stats.pressure.adaptiveMultiplier),
      pressure: parseInt(stats.pressure.level),
      queued: stats.queueSizes.total
    });
  }, 100);
  
  // إرسال موجات متزايدة
  for (let wave = 0; wave < 5; wave++) {
    const waveSize = (wave + 1) * 5000;
    console.log(`   Wave ${wave + 1}: Sending ${waveSize} messages...`);
    
    for (let i = 0; i < waveSize; i++) {
      messageBus.emit(`adaptive.test`, {
        wave,
        index: i,
        sentAt: Date.now()
      });
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
  }
  
  clearInterval(monitor);
  
  // تحليل التكيف
  const maxMultiplier = Math.max(...adaptiveHistory.map(h => h.multiplier));
  const minMultiplier = Math.min(...adaptiveHistory.map(h => h.multiplier));
  const avgPressure = adaptiveHistory.reduce((sum, h) => sum + h.pressure, 0) / adaptiveHistory.length;
  
  console.log(`   ✓ Adaptive multiplier range: ${minMultiplier} - ${maxMultiplier}`);
  console.log(`   ✓ Average pressure: ${avgPressure.toFixed(0)}%`);
  console.log(`   ✓ System adapted ${adaptiveHistory.filter((h, i) => i > 0 && h.multiplier !== adaptiveHistory[i-1].multiplier).length} times`);
}

// السيناريو 6: اختبار استقرار طويل المدى
async function scenario6() {
  console.log('\n⏱️  Scenario 6: Long-term Stability (30 seconds)');
  
  const testDuration = 30000; // 30 ثانية
  const startTime = Date.now();
  let intervalsSent = 0;
  let healthReadings = [];
  
  // إرسال مستمر بمعدل متوسط
  const sendInterval = setInterval(() => {
    for (let i = 0; i < 100; i++) {
      const priority = Math.random() < 0.1 ? 'high' : Math.random() < 0.3 ? 'normal' : 'low';
      messageBus.emit(`stability.test`, {
        seq: intervalsSent++,
        sentAt: Date.now()
      }, { priority });
    }
  }, 50); // 2000 رسالة/ثانية
  
  // مراقبة الصحة
  const healthMonitor = setInterval(() => {
    const stats = messageBus.getStats();
    healthReadings.push(stats.health);
  }, 1000);
  
  await new Promise(resolve => setTimeout(resolve, testDuration));
  
  clearInterval(sendInterval);
  clearInterval(healthMonitor);
  
  const avgHealth = healthReadings.reduce((a, b) => a + b, 0) / healthReadings.length;
  const minHealth = Math.min(...healthReadings);
  const maxHealth = Math.max(...healthReadings);
  
  console.log(`   ✓ Messages sent: ${intervalsSent * 100}`);
  console.log(`   ✓ Health range: ${minHealth}% - ${maxHealth}%`);
  console.log(`   ✓ Average health: ${avgHealth.toFixed(1)}%`);
  console.log(`   ✓ Health stability: ${maxHealth - minHealth < 20 ? '✅ Excellent' : '⚠️  Could be better'}`);
}

// ========================================
// تشغيل السيناريوهات وعرض النتائج
// ========================================

async function runProductionStressTest() {
  await scenario1();
  await scenario2();
  await scenario3();
  await scenario4();
  await scenario5();
  await scenario6();
  
  // حساب الإحصائيات النهائية
  console.log('\n📈 Final Production Test Results:');
  
  const duration = Date.now() - stats.startTime;
  const avgLatency = stats.latencies.length > 0 
    ? stats.latencies.reduce((a, b) => a + b, 0) / stats.latencies.length 
    : 0;
  const p95Latency = stats.latencies.length > 0
    ? stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.95)]
    : 0;
  const p99Latency = stats.latencies.length > 0
    ? stats.latencies.sort((a, b) => a - b)[Math.floor(stats.latencies.length * 0.99)]
    : 0;
  
  const finalStats = messageBus.getStats();
  
  console.log(`\n   📊 Overall Performance:`);
  console.log(`   Total duration: ${(duration / 1000).toFixed(2)}s`);
  console.log(`   Messages sent: ${stats.sent.toLocaleString()}`);
  console.log(`   Messages received: ${stats.received.toLocaleString()}`);
  console.log(`   Messages dropped: ${finalStats.messagesDropped.toLocaleString()}`);
  console.log(`   Success rate: ${(stats.received / stats.sent * 100).toFixed(2)}%`);
  console.log(`   Average throughput: ${(stats.received / (duration / 1000)).toFixed(0)} msg/s`);
  
  console.log(`\n   ⏱️  Latency Analysis:`);
  console.log(`   Average latency: ${avgLatency.toFixed(2)}ms`);
  console.log(`   P95 latency: ${p95Latency}ms`);
  console.log(`   P99 latency: ${p99Latency}ms`);
  
  console.log(`\n   🏥 System Health:`);
  console.log(`   Final health: ${finalStats.health}%`);
  console.log(`   Peak listeners: ${finalStats.peakListeners}`);
  console.log(`   Peak pending requests: ${finalStats.peakPendingRequests}`);
  console.log(`   Slow handlers: ${finalStats.performance.slowHandlersCount}`);
  console.log(`   Average handler execution: ${finalStats.performance.avgHandlerExecutionTime}ms`);
  
  // تحليل الأداء للإنتاج
  console.log('\n🎯 Production Readiness Assessment:');
  
  let score = 0;
  let maxScore = 0;
  
  // صحة النظام
  maxScore += 20;
  if (finalStats.health >= 90) {
    score += 20;
    console.log('   ✅ System Health: Excellent (20/20)');
  } else if (finalStats.health >= 80) {
    score += 15;
    console.log('   ⚠️  System Health: Good (15/20)');
  } else {
    score += 10;
    console.log('   ❌ System Health: Needs improvement (10/20)');
  }
  
  // معدل النجاح
  maxScore += 20;
  const successRate = (stats.received / stats.sent) * 100;
  if (successRate >= 95) {
    score += 20;
    console.log('   ✅ Message Delivery: Excellent (20/20)');
  } else if (successRate >= 85) {
    score += 15;
    console.log('   ⚠️  Message Delivery: Good (15/20)');
  } else {
    score += 10;
    console.log('   ❌ Message Delivery: Needs improvement (10/20)');
  }
  
  // زمن الاستجابة
  maxScore += 20;
  if (p95Latency < 50) {
    score += 20;
    console.log('   ✅ Response Time: Excellent (20/20)');
  } else if (p95Latency < 100) {
    score += 15;
    console.log('   ⚠️  Response Time: Good (15/20)');
  } else {
    score += 10;
    console.log('   ❌ Response Time: Needs improvement (10/20)');
  }
  
  // معالجة الأولويات
  maxScore += 20;
  const criticalDeliveryRate = stats.criticalReceived / stats.criticalSent * 100;
  if (criticalDeliveryRate >= 99) {
    score += 20;
    console.log('   ✅ Priority Handling: Excellent (20/20)');
  } else if (criticalDeliveryRate >= 95) {
    score += 15;
    console.log('   ⚠️  Priority Handling: Good (15/20)');
  } else {
    score += 10;
    console.log('   ❌ Priority Handling: Needs improvement (10/20)');
  }
  
  // معدل الإنتاجية
  maxScore += 20;
  const throughput = stats.received / (duration / 1000);
  if (throughput >= 5000) {
    score += 20;
    console.log('   ✅ Throughput: Excellent (20/20)');
  } else if (throughput >= 2500) {
    score += 15;
    console.log('   ⚠️  Throughput: Good (15/20)');
  } else {
    score += 10;
    console.log('   ❌ Throughput: Needs improvement (10/20)');
  }
  
  const finalScore = (score / maxScore) * 100;
  console.log(`\n   🏆 Production Readiness Score: ${finalScore.toFixed(0)}%`);
  
  if (finalScore >= 90) {
    console.log('   ✅ READY FOR PRODUCTION! System performs excellently under extreme load.');
  } else if (finalScore >= 75) {
    console.log('   ⚠️  MOSTLY READY. Consider tuning configuration for specific use cases.');
  } else {
    console.log('   ❌ NEEDS OPTIMIZATION. Review bottlenecks and adjust configuration.');
  }
  
  // تنظيف
  messageBus.destroy();
  process.exit(0);
}

// بدء الاختبار
runProductionStressTest().catch(console.error);
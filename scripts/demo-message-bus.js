/**
 * Message Bus Production Demo
 * 
 * يوضح الفرق بين الإعدادات العادية وإعدادات الإنتاج
 * شغله باستخدام: node scripts/demo-message-bus-production.js
 */

import { MessageBus } from '../core/message-bus.js';

console.log('🚀 Message Bus Production vs Development Comparison\n');

// إنشاء نسختين: واحدة بإعدادات التطوير وأخرى بإعدادات الإنتاج
const devBus = new MessageBus({
  maxQueueSize: 10000,
  batchSize: 100,
  enableLogging: false,
  productionMode: false
});

const prodBus = new MessageBus(MessageBus.getProductionConfig());

// دالة لاختبار أداء كل bus
async function testPerformance(bus, name) {
  console.log(`\n📊 Testing ${name} Configuration:`);
  
  const stats = {
    sent: 0,
    received: 0,
    startTime: Date.now()
  };
  
  // إضافة مستمع
  bus.on('test.*', (message) => {
    stats.received++;
  });
  
  // إرسال 20,000 رسالة بأولويات مختلفة
  console.log('   Sending 20,000 messages...');
  const sendStart = Date.now();
  
  for (let i = 0; i < 20000; i++) {
    const priority = i % 100 === 0 ? 'high' : i % 10 === 0 ? 'normal' : 'low';
    bus.emit(`test.message${i % 100}`, {
      index: i,
      data: 'x'.repeat(100)
    }, { priority });
    stats.sent++;
  }
  
  const sendTime = Date.now() - sendStart;
  console.log(`   ✓ Send time: ${sendTime}ms (${(20000 / (sendTime / 1000)).toFixed(0)} msg/s)`);
  
  // انتظار المعالجة
  await new Promise(resolve => setTimeout(resolve, 3000));
  
  const busStats = bus.getStats();
  const duration = Date.now() - stats.startTime;
  
  console.log(`   ✓ Received: ${stats.received.toLocaleString()}`);
  console.log(`   ✓ Dropped: ${busStats.messagesDropped.toLocaleString()}`);
  console.log(`   ✓ Success rate: ${(stats.received / stats.sent * 100).toFixed(2)}%`);
  console.log(`   ✓ Processing rate: ${busStats.processingRate} msg/s`);
  console.log(`   ✓ Health: ${busStats.health}%`);
  console.log(`   ✓ Pressure: ${busStats.pressure.level}`);
  
  return {
    name,
    sent: stats.sent,
    received: stats.received,
    dropped: busStats.messagesDropped,
    health: busStats.health,
    processingRate: parseFloat(busStats.processingRate),
    duration
  };
}

// تشغيل المقارنة
async function runComparison() {
  console.log('🔬 Running comparison tests...');
  
  // اختبار التطوير
  const devResults = await testPerformance(devBus, 'Development');
  
  // اختبار الإنتاج
  const prodResults = await testPerformance(prodBus, 'Production');
  
  // عرض المقارنة
  console.log('\n📈 Comparison Results:');
  console.log('┌─────────────────────┬──────────────────┬──────────────────┐');
  console.log('│ Metric              │ Development      │ Production       │');
  console.log('├─────────────────────┼──────────────────┼──────────────────┤');
  
  // معدل النجاح
  const devSuccessRate = (devResults.received / devResults.sent * 100).toFixed(1);
  const prodSuccessRate = (prodResults.received / prodResults.sent * 100).toFixed(1);
  console.log(`│ Success Rate        │ ${devSuccessRate.padEnd(15)}% │ ${prodSuccessRate.padEnd(15)}% │`);
  
  // الرسائل المسقطة
  console.log(`│ Messages Dropped    │ ${devResults.dropped.toLocaleString().padEnd(16)} │ ${prodResults.dropped.toLocaleString().padEnd(16)} │`);
  
  // معدل المعالجة
  console.log(`│ Processing Rate     │ ${devResults.processingRate.toFixed(0).padEnd(13)} m/s │ ${prodResults.processingRate.toFixed(0).padEnd(13)} m/s │`);
  
  // الصحة
  console.log(`│ System Health       │ ${devResults.health.toString().padEnd(15)}% │ ${prodResults.health.toString().padEnd(15)}% │`);
  
  console.log('└─────────────────────┴──────────────────┴──────────────────┘');
  
  // التحليل
  console.log('\n🎯 Analysis:');
  
  const dropImprovement = ((devResults.dropped - prodResults.dropped) / devResults.dropped * 100).toFixed(1);
  const rateImprovement = ((prodResults.processingRate - devResults.processingRate) / devResults.processingRate * 100).toFixed(1);
  
  if (prodResults.dropped < devResults.dropped) {
    console.log(`   ✅ Production config reduced drops by ${dropImprovement}%`);
  }
  
  if (prodResults.processingRate > devResults.processingRate) {
    console.log(`   ✅ Production config improved processing rate by ${rateImprovement}%`);
  }
  
  if (prodResults.health > devResults.health) {
    console.log(`   ✅ Production config maintained better system health`);
  }
  
  // اختبار الميزات الخاصة بالإنتاج
  console.log('\n🔧 Production-Specific Features Test:');
  
  // اختبار Priority Boost
  console.log('\n   Testing Priority Boost...');
  let highPriorityReceived = 0;
  
  prodBus.on('priority.test', (msg) => {
    if (msg.priority === 'high') highPriorityReceived++;
  });
  
  // إرسال مزيج ضخم
  for (let i = 0; i < 10000; i++) {
    const priority = i % 100 === 0 ? 'high' : 'low';
    prodBus.emit('priority.test', { i }, { priority });
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  console.log(`   ✓ High priority messages: ${highPriorityReceived}/100 delivered`);
  if (highPriorityReceived >= 99) {
    console.log('   ✅ Priority boost working perfectly!');
  }
  
  // اختبار Adaptive Processing
  console.log('\n   Testing Adaptive Processing...');
  const adaptiveReadings = [];
  
  const monitor = setInterval(() => {
    const stats = prodBus.getStats();
    adaptiveReadings.push(parseFloat(stats.pressure.adaptiveMultiplier));
  }, 100);
  
  // إرسال موجة كبيرة
  for (let i = 0; i < 30000; i++) {
    prodBus.emit('adaptive.test', { i });
  }
  
  await new Promise(resolve => setTimeout(resolve, 2000));
  clearInterval(monitor);
  
  const minMultiplier = Math.min(...adaptiveReadings);
  const maxMultiplier = Math.max(...adaptiveReadings);
  
  if (maxMultiplier > minMultiplier) {
    console.log(`   ✅ Adaptive processing working! Multiplier ranged from ${minMultiplier} to ${maxMultiplier}`);
  }
  
  // النتيجة النهائية
  console.log('\n🏆 Conclusion:');
  if (prodResults.health >= 90 && prodSuccessRate >= 95) {
    console.log('   ✅ Production configuration is READY FOR DEPLOYMENT!');
    console.log('   The system handles extreme load while maintaining excellent health.');
  } else {
    console.log('   ⚠️  Consider further tuning for your specific use case.');
  }
  
  // تنظيف
  devBus.destroy();
  prodBus.destroy();
}

// بدء المقارنة
runComparison().catch(console.error);
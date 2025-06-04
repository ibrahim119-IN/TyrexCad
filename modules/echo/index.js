/**
 * Echo Module - وحدة تجريبية بسيطة
 * 
 * ترد على الرسائل بنفس المحتوى (echo)
 * تُستخدم للاختبار والتطوير
 */

export default class EchoModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    this.echoCount = 0;
    
    this.setupHandlers();
  }

  setupHandlers() {
    // الاستماع لطلبات echo
    this.msg.on('echo.request', (message) => {
      this.echoCount++;
      
      const response = {
        echo: message.data,
        count: this.echoCount,
        timestamp: Date.now()
      };
      
      // إذا كان طلب، أرسل الرد
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: response
        });
      }
      
      // بث الحدث
      this.msg.emit('echo.response', response);
    });

    // الاستماع لطلب الإحصائيات
    this.msg.on('echo.stats', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            echoCount: this.echoCount,
            version: this.version
          }
        });
      }
    });
  }

  // دورة الحياة
  async start() {
    this.msg.emit('echo.started', {
      version: this.version
    });
  }

  async stop() {
    this.msg.emit('echo.stopped', {
      totalEchoes: this.echoCount
    });
  }

  // فحص الصحة
  async healthCheck() {
    return true; // دائماً صحي
  }

  // تنظيف
  async cleanup() {
    this.msg.off('echo.*');
    this.echoCount = 0;
  }
}
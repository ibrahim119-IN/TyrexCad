/**
 * Counter Module - وحدة عداد بحالة داخلية محدودة
 * @module CounterModule
 * @version 1.0.1
 */

export default class CounterModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.1';
    
    // الحالة الداخلية - معزولة تماماً
    this.counters = new Map();
    this.totalOperations = 0;
    
    // حدود لمنع استنزاف الموارد
    this.limits = {
      maxCounters: 10000,
      maxValue: Number.MAX_SAFE_INTEGER,
      minValue: Number.MIN_SAFE_INTEGER
    };
    
    this.setupHandlers();
  }

  setupHandlers() {
    // إنشاء عداد جديد
    this.msg.on('counter.create', (message) => {
      const { name, initialValue = 0 } = message.data;
      
      // التحقق من الحد الأقصى للعدادات
      if (this.counters.size >= this.limits.maxCounters) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Maximum counters limit reached (${this.limits.maxCounters})`
          });
        }
        return;
      }
      
      if (this.counters.has(name)) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Counter ${name} already exists`
          });
        }
        return;
      }
      
      // التحقق من القيمة الأولية
      if (!this.isValidValue(initialValue)) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: 'Initial value out of safe range'
          });
        }
        return;
      }
      
      this.counters.set(name, {
        value: initialValue,
        createdAt: Date.now(),
        operations: 0
      });
      
      this.totalOperations++;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { name, value: initialValue }
        });
      }
      
      this.msg.emit('counter.created', { name, value: initialValue });
    });

    // زيادة العداد
    this.msg.on('counter.increment', (message) => {
      const { name, amount = 1 } = message.data;
      
      const counter = this.counters.get(name);
      if (!counter) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Counter ${name} not found`
          });
        }
        return;
      }
      
      // التحقق من تجاوز الحدود
      const newValue = counter.value + amount;
      if (!this.isValidValue(newValue)) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: 'Operation would exceed safe value range'
          });
        }
        return;
      }
      
      counter.value = newValue;
      counter.operations++;
      this.totalOperations++;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { name, value: counter.value }
        });
      }
      
      this.msg.emit('counter.changed', { 
        name, 
        value: counter.value,
        operation: 'increment',
        amount 
      });
    });

    // إنقاص العداد
    this.msg.on('counter.decrement', (message) => {
      const { name, amount = 1 } = message.data;
      
      const counter = this.counters.get(name);
      if (!counter) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Counter ${name} not found`
          });
        }
        return;
      }
      
      // التحقق من تجاوز الحدود
      const newValue = counter.value - amount;
      if (!this.isValidValue(newValue)) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: 'Operation would exceed safe value range'
          });
        }
        return;
      }
      
      counter.value = newValue;
      counter.operations++;
      this.totalOperations++;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { name, value: counter.value }
        });
      }
      
      this.msg.emit('counter.changed', { 
        name, 
        value: counter.value,
        operation: 'decrement',
        amount 
      });
    });

    // الحصول على قيمة العداد
    this.msg.on('counter.get', (message) => {
      const { name } = message.data;
      
      const counter = this.counters.get(name);
      if (!counter) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Counter ${name} not found`
          });
        }
        return;
      }
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            name,
            value: counter.value,
            operations: counter.operations,
            createdAt: counter.createdAt
          }
        });
      }
    });

    // الحصول على جميع العدادات
    this.msg.on('counter.list', (message) => {
      const counters = Array.from(this.counters.entries()).map(([name, data]) => ({
        name,
        value: data.value,
        operations: data.operations,
        createdAt: data.createdAt
      }));
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: counters
        });
      }
    });

    // حذف عداد
    this.msg.on('counter.delete', (message) => {
      const { name } = message.data;
      
      if (!this.counters.has(name)) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Counter ${name} not found`
          });
        }
        return;
      }
      
      const counter = this.counters.get(name);
      this.counters.delete(name);
      this.totalOperations++;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { name, finalValue: counter.value }
        });
      }
      
      this.msg.emit('counter.deleted', { name });
    });

    // إحصائيات الوحدة
    this.msg.on('counter.stats', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            totalCounters: this.counters.size,
            totalOperations: this.totalOperations,
            limits: this.limits,
            version: this.version
          }
        });
      }
    });
  }

  /**
   * التحقق من صحة القيمة
   */
  isValidValue(value) {
    return typeof value === 'number' && 
           !isNaN(value) &&
           value >= this.limits.minValue && 
           value <= this.limits.maxValue;
  }

  // دورة الحياة
  async start() {
    this.msg.emit('counter.module.started', {
      version: this.version,
      counters: this.counters.size
    });
  }

  async stop() {
    this.msg.emit('counter.module.stopped', {
      totalCounters: this.counters.size,
      totalOperations: this.totalOperations
    });
  }

  // فحص الصحة
  async healthCheck() {
    // الوحدة صحية إذا لم تصل للحد الأقصى
    return this.counters.size < this.limits.maxCounters * 0.9;
  }

  // تنظيف
  async cleanup() {
    this.msg.off('counter.*');
    this.counters.clear();
    this.totalOperations = 0;
  }
}
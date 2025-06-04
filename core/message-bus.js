/**
 * Message Bus - قلب نظام TyrexCad
 * 
 * النسخة المحسنة للمتانة القصوى
 * 
 * هذا هو المكون الأساسي الذي يدير جميع الاتصالات في النظام.
 * لا يعرف شيئاً عن محتوى الرسائل، فقط ينقلها بكفاءة عالية.
 * 
 * يدعم ثلاثة أنماط:
 * 1. Publish/Subscribe - للأحداث العامة
 * 2. Request/Response - للطلبات التي تحتاج رد
 * 3. Wildcard patterns - للاستماع لمجموعات من الأحداث
 * 
 * التحسينات في هذه النسخة:
 * - حماية من تسجيل نفس handler مرتين
 * - حماية من الرسائل الضخمة
 * - نظام أولويات محسن
 * - مراقبة أعمق للأداء
 * - حماية أقوى من memory leaks
 * - نظام ضغط عكسي (backpressure) متقدم
 * - معالجة تكيفية حسب الضغط
 */

import { v4 as uuidv4 } from 'uuid';

export class MessageBus {
  constructor(config = {}) {
    // مخزن المستمعين - كل حدث له قائمة من المستمعين
    // استخدام Map of Maps لتخزين معلومات إضافية عن كل handler
    this.listeners = new Map();
    
    // مخزن الطلبات المعلقة - ننتظر الرد عليها
    this.pendingRequests = new Map();
    
    // مخزن handlers المسجلة لمنع التكرار
    this.handlerRegistry = new WeakMap();
    
    // إحصائيات الأداء - لمراقبة صحة النظام
    this.stats = {
      messagesSent: 0,
      messagesReceived: 0,
      messagesDropped: 0,
      requestsSent: 0,
      requestsCompleted: 0,
      requestsTimedOut: 0,
      requestsFailed: 0,
      largeMessagesWarnings: 0,
      errorsCaught: 0,
      startTime: Date.now(),
      peakListeners: 0,
      peakPendingRequests: 0
    };
    
    // إعدادات النظام مع قيم افتراضية آمنة
    this.config = {
      defaultTimeout: 5000,              // 5 ثواني timeout افتراضي
      maxTimeout: 60000,                 // حد أقصى للـ timeout
      enableLogging: false,              // لتفعيل سجل الرسائل
      enableMetrics: true,               // لتفعيل جمع المقاييس
      maxListenersPerEvent: 100,        // حد أقصى للمستمعين لكل حدث
      maxDataSize: 1024 * 1024,          // 1MB حد أقصى لحجم البيانات
      warnDataSize: 512 * 1024,          // 512KB تحذير لحجم البيانات
      maxPendingRequests: 1000,          // حد أقصى للطلبات المعلقة
      enableDuplicateHandlerCheck: true, // منع تسجيل نفس handler مرتين
      enablePriorityQueue: true,         // تفعيل نظام الأولويات
      queueProcessingDelay: 0,           // تأخير معالجة القوائم (0 = فوري)
      maxQueueSize: 10000,               // حد أقصى لحجم كل قائمة
      dropPolicy: 'oldest',              // سياسة الإسقاط: oldest, newest, low-priority
      batchSize: 100,                    // عدد الرسائل في الدفعة الواحدة
      maxProcessingTime: 16,             // أقصى وقت معالجة قبل التوقف (ms)
      enableBackpressure: true,          // تفعيل الضغط العكسي
      backpressureThreshold: 0.8,        // عتبة الضغط (80% من السعة)
      ...config
    };
    
    // قوائم انتظار حسب الأولوية
    this.messageQueues = {
      high: [],
      normal: [],
      low: []
    };
    
    // معالج قوائم الانتظار
    this.queueProcessor = null;
    this.isProcessingQueue = false;
    
    // تهيئة pattern cache مباشرة
    this.patternCache = new Map();
    
    // مؤشرات الضغط
    this.pressure = {
      level: 0, // 0-1 (0 = لا ضغط، 1 = ضغط شديد)
      dropped: 0,
      lastCheck: Date.now()
    };
  }

  /**
   * تسجيل مستمع لحدث معين مع حماية محسنة
   * @param {string} eventPattern - نمط الحدث (يدعم wildcards مع *)
   * @param {Function} handler - الدالة التي ستُنفذ عند وصول الحدث
   * @param {Object} options - خيارات إضافية (priority, once, etc.)
   * @returns {Function} دالة لإلغاء التسجيل
   */
  on(eventPattern, handler, options = {}) {
    // التحقق من صحة المدخلات بشكل صارم
    if (typeof eventPattern !== 'string' || !eventPattern) {
      throw new TypeError('Event pattern must be a non-empty string');
    }
    if (typeof handler !== 'function') {
      throw new TypeError('Handler must be a function');
    }
    
    // التحقق من الطول المعقول للـ pattern
    if (eventPattern.length > 256) {
      throw new RangeError('Event pattern too long (max 256 characters)');
    }

    // إنشاء معرف فريد للـ handler
    const handlerId = Symbol('handler');
    
    // التحقق من التكرار إذا كان مفعلاً
    if (this.config.enableDuplicateHandlerCheck) {
      if (this.handlerRegistry.has(handler)) {
        const registeredPatterns = this.handlerRegistry.get(handler);
        if (registeredPatterns.has(eventPattern)) {
          console.warn(`Handler already registered for pattern: ${eventPattern}`);
          return () => {}; // إرجاع دالة فارغة
        }
        registeredPatterns.add(eventPattern);
      } else {
        this.handlerRegistry.set(handler, new Set([eventPattern]));
      }
    }

    // إنشاء قائمة للمستمعين إذا لم تكن موجودة
    if (!this.listeners.has(eventPattern)) {
      this.listeners.set(eventPattern, new Map());
    }

    const listenersMap = this.listeners.get(eventPattern);
    
    // التحقق من عدم تجاوز الحد الأقصى
    if (listenersMap.size >= this.config.maxListenersPerEvent) {
      const error = new Error(`Maximum listeners (${this.config.maxListenersPerEvent}) reached for pattern: ${eventPattern}`);
      this.emit('system.error', { type: 'maxListeners', pattern: eventPattern, error: error.message });
      throw error;
    }

    // إضافة المستمع مع معلومات إضافية
    const listenerInfo = {
      handler,
      priority: options.priority || 'normal',
      once: options.once || false,
      addedAt: Date.now(),
      callCount: 0
    };
    
    listenersMap.set(handlerId, listenerInfo);
    
    // تحديث إحصائيات الذروة
    const totalListeners = this.getTotalListenerCount();
    if (totalListeners > this.stats.peakListeners) {
      this.stats.peakListeners = totalListeners;
    }

    // إرجاع دالة لإلغاء التسجيل
    return () => {
      const listeners = this.listeners.get(eventPattern);
      if (listeners) {
        listeners.delete(handlerId);
        if (listeners.size === 0) {
          this.listeners.delete(eventPattern);
        }
      }
      
      // تنظيف من السجل
      if (this.config.enableDuplicateHandlerCheck && this.handlerRegistry.has(handler)) {
        const patterns = this.handlerRegistry.get(handler);
        patterns.delete(eventPattern);
        if (patterns.size === 0) {
          this.handlerRegistry.delete(handler);
        }
      }
    };
  }

  /**
   * تسجيل مستمع لمرة واحدة فقط
   * @param {string} eventPattern - نمط الحدث
   * @param {Function} handler - الدالة التي ستُنفذ مرة واحدة
   * @returns {Function} دالة لإلغاء التسجيل
   */
  once(eventPattern, handler) {
    return this.on(eventPattern, handler, { once: true });
  }

  /**
   * إلغاء تسجيل مستمع (متوافق مع الإصدار السابق)
   * @param {string} eventPattern - نمط الحدث
   * @param {Function} handler - الدالة المراد إلغاؤها
   */
  off(eventPattern, handler) {
    const listeners = this.listeners.get(eventPattern);
    if (!listeners) return;
    
    // البحث عن handler وحذفه
    for (const [handlerId, info] of listeners.entries()) {
      if (info.handler === handler) {
        listeners.delete(handlerId);
        break;
      }
    }
    
    if (listeners.size === 0) {
      this.listeners.delete(eventPattern);
    }
  }

  /**
   * إرسال رسالة/حدث مع دعم الأولويات
   * @param {string} event - اسم الحدث
   * @param {any} data - البيانات المرسلة
   * @param {Object} options - خيارات إضافية
   */
  emit(event, data = {}, options = {}) {
    // التحقق من صحة المدخلات
    if (typeof event !== 'string' || !event) {
      throw new TypeError('Event must be a non-empty string');
    }
    
    // التحقق من حجم البيانات
    const dataSize = this.estimateSize(data);
    if (dataSize > this.config.maxDataSize) {
      this.stats.messagesDropped++;
      const error = new Error(`Data size (${dataSize} bytes) exceeds maximum (${this.config.maxDataSize} bytes)`);
      this.emit('system.error', { type: 'dataSize', event, size: dataSize, error: error.message });
      throw error;
    }
    
    if (dataSize > this.config.warnDataSize) {
      this.stats.largeMessagesWarnings++;
      console.warn(`Large message warning: ${event} has ${dataSize} bytes of data`);
    }

    // تسجيل الرسالة في الإحصائيات
    this.stats.messagesSent++;

    // إنشاء كائن الرسالة الكامل
    const message = {
      event,
      data,
      timestamp: Date.now(),
      id: uuidv4(),
      priority: options.priority || 'normal',
      ...options
    };

    // سجل الرسالة إذا كان التسجيل مفعلاً
    if (this.config.enableLogging) {
      console.log(`📤 Message emitted:`, { 
        event, 
        priority: message.priority,
        dataSize: `${(dataSize / 1024).toFixed(2)}KB`
      });
    }

    // إضافة للقائمة المناسبة حسب الأولوية
    if (this.config.enablePriorityQueue) {
      this.enqueueMessage(message);
      
      // بدء معالجة القوائم بعد تأخير صغير للسماح بتجميع الرسائل
      if (!this.queueProcessor) {
        this.queueProcessor = setTimeout(() => {
          this.queueProcessor = null;
          this.processMessageQueues();
        }, this.config.queueProcessingDelay);
      }
    } else {
      // معالجة فورية بدون أولويات (للتوافق مع الإصدار السابق)
      this.deliverMessage(message);
    }

    return message.id;
  }

  /**
   * إضافة رسالة للقائمة المناسبة مع حماية من الضغط الزائد
   * @private
   */
  enqueueMessage(message) {
    const priority = message.priority || 'normal';
    const queue = this.messageQueues[priority] || this.messageQueues.normal;
    
    // حساب مستوى الضغط
    this.updatePressureLevel();
    
    // التحقق من الضغط العكسي
    if (this.config.enableBackpressure && this.pressure.level > this.config.backpressureThreshold) {
      // في حالة الضغط الشديد، نسقط الرسائل ذات الأولوية المنخفضة
      if (priority === 'low' && this.pressure.level > 0.9) {
        this.pressure.dropped++;
        this.stats.messagesDropped++;
        
        if (this.config.enableLogging) {
          console.warn(`Dropping low priority message due to high pressure: ${message.event}`);
        }
        return;
      }
    }
    
    // التحقق من حجم القائمة
    if (queue.length >= this.config.maxQueueSize) {
      // تطبيق سياسة الإسقاط
      switch (this.config.dropPolicy) {
        case 'oldest':
          queue.shift(); // إزالة الأقدم
          break;
        case 'newest':
          this.pressure.dropped++;
          this.stats.messagesDropped++;
          return; // رفض الجديد
        case 'low-priority':
          // محاولة إسقاط رسالة من قائمة أولوية أقل
          if (priority !== 'low' && this.messageQueues.low.length > 0) {
            this.messageQueues.low.shift();
          } else if (priority === 'high' && this.messageQueues.normal.length > 0) {
            this.messageQueues.normal.shift();
          } else {
            queue.shift(); // إسقاط الأقدم من نفس القائمة
          }
          break;
      }
      
      this.pressure.dropped++;
      this.stats.messagesDropped++;
    }
    
    queue.push(message);
  }
  
  /**
   * تحديث مستوى الضغط على النظام
   * @private
   */
  updatePressureLevel() {
    const now = Date.now();
    
    // تحديث كل 100ms فقط لتجنب الحسابات المتكررة
    if (now - this.pressure.lastCheck < 100) return;
    
    const totalQueued = this.getTotalQueueSize();
    const maxCapacity = this.config.maxQueueSize * 3; // إجمالي السعة القصوى
    
    // حساب مستوى الضغط (0-1)
    this.pressure.level = Math.min(1, totalQueued / maxCapacity);
    
    // حساب معدل الإسقاط
    const dropRate = this.pressure.dropped / Math.max(1, this.stats.messagesSent);
    
    // تعديل مستوى الضغط بناءً على معدل الإسقاط
    if (dropRate > 0.1) { // إذا كان معدل الإسقاط > 10%
      this.pressure.level = Math.min(1, this.pressure.level + 0.2);
    }
    
    this.pressure.lastCheck = now;
    
    // تحذير عند الضغط العالي
    if (this.pressure.level > 0.9 && this.config.enableLogging) {
      console.warn(`High message bus pressure: ${Math.round(this.pressure.level * 100)}%`);
    }
  }

  /**
   * معالجة قوائم الرسائل حسب الأولوية مع حماية من الحجب
   * @private
   */
  processMessageQueues() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    // معالجة متقدمة مع حماية من حجب المتصفح
    const processNextBatch = () => {
      const startTime = performance.now();
      let processed = 0;
      
      // تحديد حجم الدفعة بناءً على مستوى الضغط
      const adaptiveBatchSize = Math.max(
        10, // حد أدنى 10 رسائل
        Math.floor(this.config.batchSize * (1 - this.pressure.level))
      );
      
      // معالجة الرسائل حتى نصل للحد أو ينتهي الوقت
      while (this.hasMessagesInQueues() && 
             processed < adaptiveBatchSize &&
             (performance.now() - startTime) < this.config.maxProcessingTime) {
        
        let message = null;
        
        // استخراج الرسالة التالية حسب الأولوية
        if (this.messageQueues.high.length > 0) {
          message = this.messageQueues.high.shift();
        } else if (this.messageQueues.normal.length > 0) {
          message = this.messageQueues.normal.shift();
        } else if (this.messageQueues.low.length > 0) {
          message = this.messageQueues.low.shift();
        }
        
        if (message) {
          this.deliverMessage(message);
          processed++;
        }
      }
      
      // حساب الوقت المستغرق
      const processingTime = performance.now() - startTime;
      
      // إذا كان هناك المزيد من الرسائل
      if (this.hasMessagesInQueues()) {
        // تحديد التأخير التالي بناءً على الضغط
        let nextDelay = 0;
        
        if (processingTime >= this.config.maxProcessingTime) {
          // إذا استغرقنا وقتاً طويلاً، أعط المتصفح فرصة أطول
          nextDelay = Math.min(50, processingTime);
        } else if (this.pressure.level > 0.5) {
          // في حالة الضغط، أبطئ المعالجة
          nextDelay = Math.floor(10 * this.pressure.level);
        }
        
        if (nextDelay > 0) {
          setTimeout(() => processNextBatch(), nextDelay);
        } else {
          // استخدام requestIdleCallback في المتصفح إذا كان متاحاً
          if (typeof requestIdleCallback !== 'undefined' && this.pressure.level < 0.5) {
            requestIdleCallback(() => processNextBatch(), { timeout: 50 });
          } else {
            setImmediate(() => processNextBatch());
          }
        }
      } else {
        this.isProcessingQueue = false;
        
        // إعادة تعيين مؤشرات الضغط عند انتهاء المعالجة
        if (this.pressure.dropped > 0) {
          if (this.config.enableLogging) {
            console.log(`Message processing completed. Dropped ${this.pressure.dropped} messages during pressure.`);
          }
          this.pressure.dropped = 0;
        }
      }
    };
    
    processNextBatch();
  }

  /**
   * توصيل رسالة للمستمعين
   * @private
   */
  deliverMessage(message) {
    const matchingHandlers = this.findMatchingHandlers(message.event);
    
    // ترتيب handlers حسب الأولوية
    const sortedHandlers = matchingHandlers.sort((a, b) => {
      const priorityOrder = { high: 0, normal: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
    
    // تنفيذ كل المستمعين بشكل غير متزامن
    sortedHandlers.forEach(handlerInfo => {
      // تنفيذ في الدورة التالية لتجنب حجب النظام
      Promise.resolve().then(() => {
        try {
          handlerInfo.callCount++;
          handlerInfo.handler(message);
          this.stats.messagesReceived++;
          
          // إزالة handler إذا كان once
          if (handlerInfo.once) {
            this.removeHandlerInfo(handlerInfo, message.event);
          }
        } catch (error) {
          this.stats.errorsCaught++;
          console.error(`Error in message handler for ${message.event}:`, error);
          
          // بث حدث خطأ للنظام
          if (message.event !== 'system.error') {
            // تجنب الحلقة اللانهائية
            setImmediate(() => {
              this.emit('system.error', {
                originalEvent: message.event,
                error: error.message,
                stack: error.stack,
                handlerInfo: {
                  priority: handlerInfo.priority,
                  callCount: handlerInfo.callCount
                }
              }, { priority: 'high' });
            });
          }
        }
      });
    });
  }

  /**
   * إرسال طلب وانتظار الرد مع حماية محسنة
   * @param {string} event - اسم الحدث
   * @param {any} data - البيانات المرسلة
   * @param {number} timeout - مهلة الانتظار (ms)
   * @returns {Promise} وعد بالرد
   */
  request(event, data = {}, timeout = null) {
    // التحقق من عدم تجاوز حد الطلبات المعلقة
    if (this.pendingRequests.size >= this.config.maxPendingRequests) {
      this.stats.requestsFailed++;
      return Promise.reject(new Error(`Maximum pending requests (${this.config.maxPendingRequests}) reached`));
    }

    return new Promise((resolve, reject) => {
      const requestId = uuidv4();
      const timeoutMs = Math.min(
        timeout || this.config.defaultTimeout,
        this.config.maxTimeout
      );
      
      // تسجيل في الإحصائيات
      this.stats.requestsSent++;
      
      // تحديث إحصائيات الذروة
      if (this.pendingRequests.size + 1 > this.stats.peakPendingRequests) {
        this.stats.peakPendingRequests = this.pendingRequests.size + 1;
      }

      // إعداد timeout
      const timeoutHandle = setTimeout(() => {
        const request = this.pendingRequests.get(requestId);
        if (request) {
          this.pendingRequests.delete(requestId);
          this.stats.requestsTimedOut++;
          reject(new Error(`Request timeout for ${event} after ${timeoutMs}ms`));
        }
      }, timeoutMs);

      // حفظ معلومات الطلب
      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timeoutHandle,
        event,
        startTime: Date.now(),
        timeout: timeoutMs
      });

      // إرسال الطلب مع معرف الطلب وأولوية عالية
      this.emit(event, data, { requestId, priority: 'high' });
    });
  }

  /**
   * الرد على طلب مع حماية محسنة
   * @param {string} requestId - معرف الطلب
   * @param {Object} response - الرد (يحتوي على success و result/error)
   */
  reply(requestId, response) {
    if (!requestId || typeof requestId !== 'string') {
      console.warn('Invalid requestId provided to reply');
      return;
    }

    const pendingRequest = this.pendingRequests.get(requestId);
    
    if (!pendingRequest) {
      console.warn(`No pending request found for ID: ${requestId}`);
      return;
    }

    // إلغاء timeout
    clearTimeout(pendingRequest.timeoutHandle);
    
    // حساب وقت الاستجابة
    const responseTime = Date.now() - pendingRequest.startTime;
    
    // إزالة من قائمة الانتظار
    this.pendingRequests.delete(requestId);
    
    // تسجيل في الإحصائيات
    if (response && response.success) {
      this.stats.requestsCompleted++;
      pendingRequest.resolve(response.result);
    } else {
      this.stats.requestsFailed++;
      pendingRequest.reject(new Error(response?.error || 'Request failed'));
    }

    // سجل أداء الطلب إذا كان بطيئاً
    if (responseTime > pendingRequest.timeout * 0.8) {
      console.warn(`Slow request detected: ${pendingRequest.event} took ${responseTime}ms (${Math.round(responseTime / pendingRequest.timeout * 100)}% of timeout)`);
    }
    
    // بث حدث أداء للمراقبة
    if (this.config.enableMetrics) {
      this.emit('system.metrics.request', {
        event: pendingRequest.event,
        responseTime,
        success: response?.success || false
      }, { priority: 'low' });
    }
  }

  /**
   * البحث عن المستمعين المطابقين لحدث معين
   * @private
   */
  findMatchingHandlers(event) {
    const handlers = [];

    this.listeners.forEach((listenersMap, pattern) => {
      if (this.eventMatchesPattern(event, pattern)) {
        listenersMap.forEach(handlerInfo => {
          handlers.push(handlerInfo);
        });
      }
    });

    return handlers;
  }

  /**
   * التحقق من مطابقة حدث لنمط معين
   * @private
   */
  eventMatchesPattern(event, pattern) {
    // مطابقة تامة
    if (event === pattern) return true;
    
    // النجمة تطابق كل شيء
    if (pattern === '*') return true;
    
    // استخدام cache للـ regex patterns
    let regex = this.patternCache.get(pattern);
    if (!regex) {
      // تحويل النمط لـ regex
      const regexPattern = pattern
        .replace(/[.+?^${}()|[\]\\]/g, '\\$&')  // هروب من الرموز الخاصة
        .replace(/\*/g, '.*');  // استبدال * بـ .*
      
      regex = new RegExp(`^${regexPattern}$`);
      this.patternCache.set(pattern, regex);
    }
    
    return regex.test(event);
  }

  /**
   * تقدير حجم البيانات (تقريبي)
   * @private
   */
  estimateSize(obj) {
    try {
      return JSON.stringify(obj).length;
    } catch (e) {
      // في حالة circular reference أو خطأ آخر
      return 0;
    }
  }

  /**
   * إزالة handler info
   * @private
   */
  removeHandlerInfo(handlerInfo, eventPattern) {
    this.listeners.forEach((listenersMap, pattern) => {
      if (this.eventMatchesPattern(eventPattern, pattern)) {
        listenersMap.forEach((info, handlerId) => {
          if (info === handlerInfo) {
            listenersMap.delete(handlerId);
            if (listenersMap.size === 0) {
              this.listeners.delete(pattern);
            }
          }
        });
      }
    });
  }

  /**
   * الحصول على العدد الكلي للمستمعين
   * @private
   */
  getTotalListenerCount() {
    let count = 0;
    this.listeners.forEach(listenersMap => {
      count += listenersMap.size;
    });
    return count;
  }

  /**
   * التحقق من وجود رسائل في القوائم
   * @private
   */
  hasMessagesInQueues() {
    return this.messageQueues.high.length > 0 ||
           this.messageQueues.normal.length > 0 ||
           this.messageQueues.low.length > 0;
  }

  /**
   * الحصول على حجم القوائم الكلي
   * @private
   */
  getTotalQueueSize() {
    return this.messageQueues.high.length +
           this.messageQueues.normal.length +
           this.messageQueues.low.length;
  }

  /**
   * الحصول على إحصائيات النظام المحسنة
   */
  getStats() {
    const uptime = Date.now() - this.stats.startTime;
    const messagesPerSecond = this.stats.messagesSent / (uptime / 1000);
    const successRate = this.stats.requestsSent > 0 
      ? (this.stats.requestsCompleted / this.stats.requestsSent * 100).toFixed(2)
      : 100;
    
    // حساب معدل المعالجة الفعلي
    const processingRate = this.stats.messagesReceived / (uptime / 1000);
    
    // حساب معدل الإسقاط
    const dropRate = this.stats.messagesSent > 0
      ? (this.stats.messagesDropped / this.stats.messagesSent * 100).toFixed(2)
      : 0;
    
    return {
      ...this.stats,
      uptime,
      uptimeHuman: this.formatUptime(uptime),
      messagesPerSecond: messagesPerSecond.toFixed(2),
      processingRate: processingRate.toFixed(2),
      pendingRequests: this.pendingRequests.size,
      totalListeners: this.getTotalListenerCount(),
      queueSizes: {
        high: this.messageQueues.high.length,
        normal: this.messageQueues.normal.length,
        low: this.messageQueues.low.length,
        total: this.getTotalQueueSize()
      },
      pressure: {
        level: Math.round(this.pressure.level * 100) + '%',
        dropped: this.pressure.dropped,
        isUnderPressure: this.pressure.level > this.config.backpressureThreshold
      },
      performance: {
        dropRate: dropRate + '%',
        requestSuccessRate: successRate + '%',
        queueUtilization: Math.round((this.getTotalQueueSize() / (this.config.maxQueueSize * 3)) * 100) + '%'
      },
      health: this.calculateHealth()
    };
  }

  /**
   * حساب صحة النظام
   * @private
   */
  calculateHealth() {
    const factors = [];
    
    // معدل نجاح الطلبات
    if (this.stats.requestsSent > 0) {
      const successRate = this.stats.requestsCompleted / this.stats.requestsSent;
      factors.push(successRate);
    } else {
      factors.push(1);
    }
    
    // معدل الأخطاء
    const errorRate = this.stats.messagesSent > 0 
      ? 1 - (this.stats.errorsCaught / this.stats.messagesSent)
      : 1;
    factors.push(errorRate);
    
    // حجم القوائم
    const queueHealth = 1 - (this.getTotalQueueSize() / 1000);
    factors.push(Math.max(0, queueHealth));
    
    // الطلبات المعلقة
    const pendingHealth = 1 - (this.pendingRequests.size / this.config.maxPendingRequests);
    factors.push(Math.max(0, pendingHealth));
    
    const health = factors.reduce((a, b) => a + b, 0) / factors.length * 100;
    return Math.round(health);
  }

  /**
   * تنسيق وقت التشغيل
   * @private
   */
  formatUptime(ms) {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if (days > 0) return `${days}d ${hours % 24}h`;
    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * تفعيل/إلغاء تسجيل الرسائل
   */
  setLogging(enabled) {
    this.config.enableLogging = enabled;
  }

  /**
   * تنظيف وإيقاف Message Bus بشكل آمن
   */
  destroy() {
    // إيقاف معالجة القوائم
    this.isProcessingQueue = false;
    if (this.queueProcessor) {
      clearTimeout(this.queueProcessor);
      this.queueProcessor = null;
    }
    
    // إلغاء جميع الطلبات المعلقة
    this.pendingRequests.forEach((request, id) => {
      clearTimeout(request.timeoutHandle);
      request.reject(new Error('Message bus destroyed'));
    });
    
    // مسح كل شيء
    this.listeners.clear();
    this.pendingRequests.clear();
    this.handlerRegistry = new WeakMap();
    this.messageQueues.high.length = 0;
    this.messageQueues.normal.length = 0;
    this.messageQueues.low.length = 0;
    
    if (this.patternCache) {
      this.patternCache.clear();
    }
    
    console.log('Message Bus destroyed safely');
  }
}

// تصدير MessageAPI المبسط للوحدات
export function createMessageAPI(messageBus, moduleName) {
  if (!messageBus || !(messageBus instanceof MessageBus)) {
    throw new TypeError('Valid MessageBus instance required');
  }
  if (!moduleName || typeof moduleName !== 'string') {
    throw new TypeError('Module name must be a non-empty string');
  }

  return {
    emit: (event, data, options) => 
      messageBus.emit(event, data, { ...options, source: moduleName }),
    
    on: (pattern, handler, options) => 
      messageBus.on(pattern, handler, options),
    
    once: (pattern, handler) => 
      messageBus.once(pattern, handler),
    
    off: (pattern, handler) => 
      messageBus.off(pattern, handler),
    
    request: (event, data, timeout) => 
      messageBus.request(event, data, timeout),
    
    reply: (requestId, response) => 
      messageBus.reply(requestId, response),
    
    getStats: () => messageBus.getStats()
  };
}
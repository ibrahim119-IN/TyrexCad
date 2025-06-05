/**
 * OCCT Bridge Module
 * 
 * يدير Web Workers لتنفيذ عمليات OpenCASCADE
 * جميع العمليات تتم في workers منفصلة لعدم حجب الواجهة
 */

export default class OCCTBridge {
  constructor(messageBus) {
    this.messageBus = messageBus;
    
    // Worker pool configuration
    this.minWorkers = 2;
    this.maxWorkers = 8;
    this.workers = [];
    this.availableWorkers = [];
    this.busyWorkers = new Map(); // taskId -> worker
    
    // Task management
    this.taskQueue = [];
    this.activeTasks = new Map();
    this.taskIdCounter = 0;
    
    // Performance monitoring
    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      averageTime: 0
    };
    
    this.setupHandlers();
    this.initializeWorkerPool();
  }
  
  /**
   * إعداد معالجات الرسائل
   */
  setupHandlers() {
    // عمليات الأشكال الأساسية
    this.messageBus.on('occt.createBox', this.handleCreateBox.bind(this));
    this.messageBus.on('occt.createSphere', this.handleCreateSphere.bind(this));
    this.messageBus.on('occt.createCylinder', this.handleCreateCylinder.bind(this));
    this.messageBus.on('occt.createCone', this.handleCreateCone.bind(this));
    this.messageBus.on('occt.createTorus', this.handleCreateTorus.bind(this));
    
    // عمليات Boolean
    this.messageBus.on('occt.boolean', this.handleBoolean.bind(this));
    
    // عمليات التحويل
    this.messageBus.on('occt.transform', this.handleTransform.bind(this));
    this.messageBus.on('occt.toMesh', this.handleToMesh.bind(this));
    
    // عمليات القياس والتحليل
    this.messageBus.on('occt.measure', this.handleMeasure.bind(this));
    
    // عمليات التعديل
    this.messageBus.on('occt.fillet', this.handleFillet.bind(this));
    this.messageBus.on('occt.chamfer', this.handleChamfer.bind(this));
    
    // عمليات البثق والدوران
    this.messageBus.on('occt.extrude', this.handleExtrude.bind(this));
    this.messageBus.on('occt.revolve', this.handleRevolve.bind(this));
    
    // إدارة النظام
    this.messageBus.on('occt.release', (message) => {
      const { id } = message.data;
      this.executeOperation('release', { shapeId: id })
        .catch(error => {
          console.warn('Failed to release shape:', error);
        });
    });
    
    this.messageBus.on('occt.getWorkerStatus', (message) => {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result: {
            total: this.workers.length,
            available: this.availableWorkers.length,
            busy: this.busyWorkers.size,
            queued: this.taskQueue.length
          }
        });
      }
    });
  }
  
  /**
   * تهيئة مجموعة Workers
   */
  async initializeWorkerPool() {
    try {
      // الحصول على URLs للموارد
      const wasmUrl = await this.messageBus.request('resources.getUrl', {
        resource: 'opencascade.wasm',
        absolute: true
      });
      
      const jsUrl = await this.messageBus.request('resources.getUrl', {
        resource: 'opencascade.js',
        absolute: true
      });
      
      // إنشاء Workers الأولية
      const workerPromises = [];
      for (let i = 0; i < this.minWorkers; i++) {
        workerPromises.push(this.createWorker(wasmUrl, jsUrl));
      }
      
      const workers = await Promise.all(workerPromises);
      this.workers = workers;
      this.availableWorkers = [...workers];
      
      this.messageBus.emit('occt.ready', {
        workerCount: this.workers.length
      });
      
    } catch (error) {
      console.error('Failed to initialize OCCT worker pool:', error);
      this.messageBus.emit('occt.error', {
        type: 'initialization',
        error: error.message
      });
    }
  }
  
  /**
   * إنشاء worker جديد
   */
  async createWorker(wasmUrl, jsUrl) {
    return new Promise((resolve, reject) => {
      // استخدام المسار الصحيح للـ worker
      const worker = new Worker('/public/workers/occt-worker.js', { type: 'module' });
      
      let ready = false;
      
      worker.onmessage = (e) => {
        if (e.data.type === 'ready' && !ready) {
          ready = true;
          resolve(worker);
        } else if (e.data.type === 'error' && !ready) {
          reject(new Error(e.data.error));
        }
        // معالجة رسائل أخرى
        this.handleWorkerMessage(worker, e);
      };
      
      worker.onerror = (error) => {
        console.error('Worker error:', error);
        if (!ready) {
          reject(error);
        } else {
          this.handleWorkerCrash(worker);
        }
      };
      
      // تهيئة الـ worker
      worker.postMessage({
        type: 'init',
        wasmUrl,
        jsUrl
      });
    });
  }
  
  /**
   * معالجة رسائل Worker
   */
  handleWorkerMessage(worker, event) {
    const { type, taskId, result, error } = event.data;
    
    switch (type) {
      case 'result':
        this.handleTaskComplete(taskId, result);
        break;
        
      case 'error':
        this.handleTaskError(taskId, error);
        break;
        
      case 'log':
        console.log('[Worker]:', result);
        break;
    }
  }
  
  /**
   * تنفيذ عملية في worker
   */
  async executeOperation(operation, params) {
    const taskId = `task_${++this.taskIdCounter}`;
    const startTime = Date.now();
    
    return new Promise((resolve, reject) => {
      const task = {
        id: taskId,
        operation,
        params,
        resolve,
        reject,
        startTime
      };
      
      this.activeTasks.set(taskId, task);
      this.taskQueue.push(task);
      this.processNextTask();
    });
  }
  
  /**
   * معالجة المهمة التالية
   */
  processNextTask() {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }
    
    const task = this.taskQueue.shift();
    const worker = this.availableWorkers.shift();
    
    this.busyWorkers.set(task.id, worker);
    
    worker.postMessage({
      type: 'execute',
      taskId: task.id,
      operation: task.operation,
      params: task.params
    });
  }
  
  /**
   * معالجة إكمال المهمة
   */
  handleTaskComplete(taskId, result) {
    const task = this.activeTasks.get(taskId);
    if (!task) return;
    
    const worker = this.busyWorkers.get(taskId);
    if (worker) {
      this.busyWorkers.delete(taskId);
      this.availableWorkers.push(worker);
    }
    
    // تحديث الإحصائيات
    const duration = Date.now() - task.startTime;
    this.stats.completedTasks++;
    this.stats.totalTasks++;
    this.stats.averageTime = 
      (this.stats.averageTime * (this.stats.completedTasks - 1) + duration) / 
      this.stats.completedTasks;
    
    // إكمال المهمة
    task.resolve(result);
    this.activeTasks.delete(taskId);
    
    // معالجة المهمة التالية
    this.processNextTask();
  }
  
  /**
   * معالجة خطأ المهمة
   */
  handleTaskError(taskId, error) {
    const task = this.activeTasks.get(taskId);
    if (!task) return;
    
    const worker = this.busyWorkers.get(taskId);
    if (worker) {
      this.busyWorkers.delete(taskId);
      this.availableWorkers.push(worker);
    }
    
    // تحديث الإحصائيات
    this.stats.failedTasks++;
    this.stats.totalTasks++;
    
    // رفض المهمة
    task.reject(new Error(error));
    this.activeTasks.delete(taskId);
    
    // معالجة المهمة التالية
    this.processNextTask();
  }
  
  /**
   * معالجة تعطل Worker
   */
  async handleWorkerCrash(crashedWorker) {
    // إزالة من القوائم
    const index = this.workers.indexOf(crashedWorker);
    if (index > -1) {
      this.workers.splice(index, 1);
    }
    
    const availIndex = this.availableWorkers.indexOf(crashedWorker);
    if (availIndex > -1) {
      this.availableWorkers.splice(availIndex, 1);
    }
    
    // البحث عن المهام المعلقة
    for (const [taskId, worker] of this.busyWorkers) {
      if (worker === crashedWorker) {
        const task = this.activeTasks.get(taskId);
        if (task) {
          this.taskQueue.unshift(task);
          this.busyWorkers.delete(taskId);
        }
      }
    }
    
    // إنشاء worker جديد
    try {
      const wasmUrl = await this.messageBus.request('resources.getUrl', {
        resource: 'opencascade.wasm',
        absolute: true
      });
      const jsUrl = await this.messageBus.request('resources.getUrl', {
        resource: 'opencascade.js',
        absolute: true
      });
      
      const newWorker = await this.createWorker(wasmUrl, jsUrl);
      this.workers.push(newWorker);
      this.availableWorkers.push(newWorker);
      
      this.processNextTask();
    } catch (error) {
      console.error('Failed to create replacement worker:', error);
      this.messageBus.emit('occt.workerError', {
        type: 'replacement-failed',
        error: error.message
      });
    }
  }
  
  // معالجات العمليات المختلفة
  
  async handleCreateBox(message) {
    try {
      const result = await this.executeOperation('createBox', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeCreated', {
        type: 'box',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleCreateSphere(message) {
    try {
      const result = await this.executeOperation('createSphere', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeCreated', {
        type: 'sphere',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleCreateCylinder(message) {
    try {
      const result = await this.executeOperation('createCylinder', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeCreated', {
        type: 'cylinder',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleCreateCone(message) {
    try {
      const result = await this.executeOperation('createCone', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeCreated', {
        type: 'cone',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleCreateTorus(message) {
    try {
      const result = await this.executeOperation('createTorus', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeCreated', {
        type: 'torus',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleBoolean(message) {
    try {
      const result = await this.executeOperation('boolean', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeModified', {
        operation: 'boolean',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleTransform(message) {
    try {
      const result = await this.executeOperation('transform', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeTransformed', {
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleToMesh(message) {
    try {
      const result = await this.executeOperation('toMesh', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.meshGenerated', {
        mesh: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleMeasure(message) {
    try {
      const result = await this.executeOperation('measure', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleFillet(message) {
    try {
      const result = await this.executeOperation('fillet', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeModified', {
        operation: 'fillet',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleChamfer(message) {
    try {
      const result = await this.executeOperation('chamfer', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeModified', {
        operation: 'chamfer',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleExtrude(message) {
    try {
      const result = await this.executeOperation('extrude', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeCreated', {
        type: 'extrusion',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  async handleRevolve(message) {
    try {
      const result = await this.executeOperation('revolve', message.data);
      
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: true,
          result
        });
      }
      
      this.messageBus.emit('occt.shapeCreated', {
        type: 'revolution',
        shape: result
      });
      
    } catch (error) {
      if (message.requestId) {
        this.messageBus.reply(message.requestId, {
          success: false,
          error: error.message
        });
      }
    }
  }
  
  /**
   * تنظيف الموارد
   */
  cleanup() {
    // إيقاف جميع Workers
    this.workers.forEach(worker => {
      worker.postMessage({ type: 'shutdown' });
      worker.terminate();
    });
    
    this.workers = [];
    this.availableWorkers = [];
    this.busyWorkers.clear();
    this.taskQueue = [];
    this.activeTasks.clear();
  }
}
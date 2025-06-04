/**
 * Geometry Test Module - موديول اختبار OCCT
 * 
 * يوضح كيفية استخدام OCCT Bridge من موديول معزول
 * مع اتباع قواعد TyrexCAD الصارمة
 */

// إضافة حدود
const LIMITS = {
  MAX_SHAPES: 10000,
  MAX_OPERATIONS_PER_SHAPE: 1000
};

export default class GeometryTestModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // الأشكال المُنشأة
    this.shapes = new Map();
    this.shapeCounter = 0;
    
    // تتبع العمليات لكل شكل
    this.shapeOperations = new Map();
    
    this.setupHandlers();
    
    // انتظار جاهزية OCCT
    this.msg.once('occt.ready', () => {
      console.log('GeometryTest: OCCT is ready!');
      this.runTests();
    });
  }

  setupHandlers() {
    // إنشاء صندوق
    this.msg.on('geometry-test.createBox', async (message) => {
      // فحص الحدود
      if (this.shapes.size >= LIMITS.MAX_SHAPES) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Maximum shapes limit reached (${LIMITS.MAX_SHAPES})`
          });
        }
        return;
      }
      
      try {
        const result = await this.msg.request('occt.executeOperation', {
          operation: 'createBox',
          params: message.data
        });
        
        const id = `shape_${this.shapeCounter++}`;
        this.shapes.set(id, result);
        this.shapeOperations.set(id, 1); // عملية الإنشاء
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { id, ...result }
          });
        }
        
        this.msg.emit('geometry-test.shapeCreated', {
          id,
          type: 'box',
          properties: result.properties
        });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // إنشاء كرة
    this.msg.on('geometry-test.createSphere', async (message) => {
      // فحص الحدود
      if (this.shapes.size >= LIMITS.MAX_SHAPES) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Maximum shapes limit reached (${LIMITS.MAX_SHAPES})`
          });
        }
        return;
      }
      
      try {
        const result = await this.msg.request('occt.executeOperation', {
          operation: 'createSphere',
          params: message.data
        });
        
        const id = `shape_${this.shapeCounter++}`;
        this.shapes.set(id, result);
        this.shapeOperations.set(id, 1); // عملية الإنشاء
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { id, ...result }
          });
        }
        
        this.msg.emit('geometry-test.shapeCreated', {
          id,
          type: 'sphere',
          properties: result.properties
        });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // إنشاء أسطوانة
    this.msg.on('geometry-test.createCylinder', async (message) => {
      // فحص الحدود
      if (this.shapes.size >= LIMITS.MAX_SHAPES) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Maximum shapes limit reached (${LIMITS.MAX_SHAPES})`
          });
        }
        return;
      }
      
      try {
        const result = await this.msg.request('occt.executeOperation', {
          operation: 'createCylinder',
          params: message.data
        });
        
        const id = `shape_${this.shapeCounter++}`;
        this.shapes.set(id, result);
        this.shapeOperations.set(id, 1); // عملية الإنشاء
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { id, ...result }
          });
        }
        
        this.msg.emit('geometry-test.shapeCreated', {
          id,
          type: 'cylinder',
          properties: result.properties
        });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // عملية Boolean
    this.msg.on('geometry-test.boolean', async (message) => {
      const { operation, shape1Id, shape2Id } = message.data;
      
      const shape1 = this.shapes.get(shape1Id);
      const shape2 = this.shapes.get(shape2Id);
      
      if (!shape1 || !shape2) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: 'One or both shapes not found'
          });
        }
        return;
      }
      
      // فحص حدود العمليات
      const shape1Ops = this.shapeOperations.get(shape1Id) || 0;
      const shape2Ops = this.shapeOperations.get(shape2Id) || 0;
      
      if (shape1Ops >= LIMITS.MAX_OPERATIONS_PER_SHAPE || shape2Ops >= LIMITS.MAX_OPERATIONS_PER_SHAPE) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Maximum operations limit reached for shape (${LIMITS.MAX_OPERATIONS_PER_SHAPE})`
          });
        }
        return;
      }
      
      // فحص حد الأشكال للشكل الناتج
      if (this.shapes.size >= LIMITS.MAX_SHAPES) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Maximum shapes limit reached (${LIMITS.MAX_SHAPES})`
          });
        }
        return;
      }
      
      try {
        const result = await this.msg.request('occt.executeOperation', {
          operation: 'boolean',
          params: {
            operation,
            shape1: shape1.geometry,
            shape2: shape2.geometry
          }
        });
        
        const id = `shape_${this.shapeCounter++}`;
        this.shapes.set(id, result);
        
        // تحديث عدد العمليات
        this.shapeOperations.set(shape1Id, shape1Ops + 1);
        this.shapeOperations.set(shape2Id, shape2Ops + 1);
        this.shapeOperations.set(id, 1);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { id, ...result }
          });
        }
        
        this.msg.emit('geometry-test.shapeCreated', {
          id,
          type: 'boolean',
          operation,
          source: [shape1Id, shape2Id]
        });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // تحويل لـ mesh
    this.msg.on('geometry-test.toMesh', async (message) => {
      const { shapeId, quality = 0.1 } = message.data;
      
      const shape = this.shapes.get(shapeId);
      if (!shape) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: 'Shape not found'
          });
        }
        return;
      }
      
      // فحص حدود العمليات
      const shapeOps = this.shapeOperations.get(shapeId) || 0;
      if (shapeOps >= LIMITS.MAX_OPERATIONS_PER_SHAPE) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Maximum operations limit reached for shape (${LIMITS.MAX_OPERATIONS_PER_SHAPE})`
          });
        }
        return;
      }
      
      try {
        const mesh = await this.msg.request('occt.executeOperation', {
          operation: 'toMesh',
          params: {
            shape: shape.geometry,
            quality
          }
        });
        
        // تحديث عدد العمليات
        this.shapeOperations.set(shapeId, shapeOps + 1);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { shapeId, mesh }
          });
        }
        
        this.msg.emit('geometry-test.meshGenerated', {
          shapeId,
          vertexCount: mesh.vertices.length / 3,
          triangleCount: mesh.indices.length / 3
        });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // قائمة الأشكال
    this.msg.on('geometry-test.listShapes', (message) => {
      const shapes = Array.from(this.shapes.entries()).map(([id, shape]) => ({
        id,
        type: shape.type,
        properties: shape.properties,
        operations: this.shapeOperations.get(id) || 0
      }));
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            shapes,
            count: shapes.length,
            limits: {
              maxShapes: LIMITS.MAX_SHAPES,
              maxOperationsPerShape: LIMITS.MAX_OPERATIONS_PER_SHAPE
            }
          }
        });
      }
    });

    // معلومات OCCT
    this.msg.on('geometry-test.occtInfo', async (message) => {
      try {
        const info = await this.msg.request('occt.info');
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: info
          });
        }
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // حذف شكل
    this.msg.on('geometry-test.deleteShape', async (message) => {
      const { shapeId } = message.data;
      
      if (!this.shapes.has(shapeId)) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: 'Shape not found'
          });
        }
        return;
      }
      
      try {
        // حذف الشكل
        this.shapes.delete(shapeId);
        this.shapeOperations.delete(shapeId);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { deletedId: shapeId }
          });
        }
        
        this.msg.emit('geometry-test.shapeDeleted', {
          id: shapeId
        });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // مسح جميع الأشكال
    this.msg.on('geometry-test.clearAll', async (message) => {
      try {
        const count = this.shapes.size;
        this.shapes.clear();
        this.shapeOperations.clear();
        this.shapeCounter = 0;
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { clearedCount: count }
          });
        }
        
        this.msg.emit('geometry-test.allCleared', {
          count
        });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });
  }

  /**
   * تشغيل اختبارات تلقائية
   */
  async runTests() {
    console.log('Running OCCT tests...');
    
    try {
      // اختبار 1: إنشاء صندوق
      console.log('Test 1: Creating box...');
      const box = await this.msg.request('geometry-test.createBox', {
        width: 100,
        height: 100,
        depth: 100,
        center: true
      });
      console.log('✓ Box created:', box.result.id);
      
      // اختبار 2: إنشاء كرة
      console.log('Test 2: Creating sphere...');
      const sphere = await this.msg.request('geometry-test.createSphere', {
        radius: 60,
        center: [0, 0, 0]
      });
      console.log('✓ Sphere created:', sphere.result.id);
      
      // اختبار 3: Boolean operation
      console.log('Test 3: Boolean subtract...');
      const boolResult = await this.msg.request('geometry-test.boolean', {
        operation: 'subtract',
        shape1Id: box.result.id,
        shape2Id: sphere.result.id
      });
      console.log('✓ Boolean operation completed:', boolResult.result.id);
      
      // اختبار 4: معلومات OCCT
      console.log('Test 4: Getting OCCT info...');
      const info = await this.msg.request('geometry-test.occtInfo');
      console.log('✓ OCCT info:', info.result);
      
      // اختبار 5: قائمة الأشكال
      console.log('Test 5: Listing shapes...');
      const shapesList = await this.msg.request('geometry-test.listShapes');
      console.log('✓ Shapes count:', shapesList.result.count);
      console.log('  Limits:', shapesList.result.limits);
      
      console.log('All tests completed successfully! 🎉');
      
    } catch (error) {
      console.error('Test failed:', error);
    }
  }

  // دورة الحياة
  async start() {
    console.log('GeometryTest module started');
    console.log(`Limits: MAX_SHAPES=${LIMITS.MAX_SHAPES}, MAX_OPERATIONS=${LIMITS.MAX_OPERATIONS_PER_SHAPE}`);
  }

  async stop() {
    this.shapes.clear();
    this.shapeOperations.clear();
  }

  async healthCheck() {
    return {
      healthy: true,
      shapesCount: this.shapes.size,
      limits: LIMITS
    };
  }

  async cleanup() {
    this.msg.off('geometry-test.*');
    this.shapes.clear();
    this.shapeOperations.clear();
  }
}
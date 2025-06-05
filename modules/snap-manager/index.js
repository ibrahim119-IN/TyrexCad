/**
 * Snap Manager Module - مدير الالتقاط الذكي
 * @module SnapManagerModule
 * @version 1.0.0
 * 
 * مسؤول عن:
 * - الالتقاط للشبكة (Grid)
 * - الالتقاط للنقاط الهندسية (endpoints, midpoints, centers)
 * - الالتقاط للخطوط والمنحنيات
 * - الالتقاط للتقاطعات
 * - إدارة أولويات الالتقاط
 */

export default class SnapManagerModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // إعدادات الالتقاط
    this.config = {
      enabled: true,
      tolerance: 10, // pixels
      gridSize: 10,  // mm
      showIndicators: true,
      showTooltips: true
    };
    
    // أنواع الالتقاط مع أولوياتها
    this.snapTypes = {
      endpoint: { enabled: true, priority: 1, tolerance: 10 },
      midpoint: { enabled: true, priority: 2, tolerance: 10 },
      center: { enabled: true, priority: 3, tolerance: 10 },
      intersection: { enabled: true, priority: 4, tolerance: 10 },
      perpendicular: { enabled: true, priority: 5, tolerance: 10 },
      tangent: { enabled: true, priority: 6, tolerance: 10 },
      grid: { enabled: true, priority: 7, tolerance: 15 },
      nearest: { enabled: false, priority: 8, tolerance: 20 },
      quadrant: { enabled: false, priority: 9, tolerance: 10 }
    };
    
    // الكائنات الهندسية المتاحة للالتقاط
    this.geometryObjects = new Map(); // objectId -> geometry data
    
    // نقاط الالتقاط المحسوبة
    this.snapPoints = new Map(); // type -> points array
    
    // الفهرس المكاني للأداء
    this.spatialIndex = new Map(); // grid cell -> objects
    this.indexCellSize = 50; // mm
    
    // حالة الالتقاط الحالية
    this.currentSnap = {
      active: false,
      type: null,
      point: null,
      objectId: null,
      tolerance: 0
    };
    
    // إحصائيات
    this.stats = {
      snapOperations: 0,
      snapHits: 0,
      spatialQueries: 0,
      cacheHits: 0,
      lastUpdateTime: 0
    };
    
    // Cache للحسابات المكلفة
    this.calculationCache = new Map();
    this.maxCacheSize = 1000;
    
    this.setupHandlers();
    
    // بث رسالة الجاهزية
    this.msg.emit('snap.ready', {
      version: this.version,
      enabled: this.config.enabled,
      types: Object.keys(this.snapTypes)
    });
  }

  setupHandlers() {
    // تفعيل/تعطيل الالتقاط
    this.msg.on('snap.setEnabled', (message) => {
      const { enabled } = message.data;
      this.config.enabled = !!enabled;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { enabled: this.config.enabled }
        });
      }
      
      this.msg.emit('snap.enabledChanged', {
        enabled: this.config.enabled
      });
    });

    // ضبط إعدادات الالتقاط
    this.msg.on('snap.configure', (message) => {
      const { config } = message.data;
      
      try {
        this.updateConfiguration(config);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: this.config
          });
        }
        
        this.msg.emit('snap.configChanged', this.config);
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // ضبط نوع التقاط محدد
    this.msg.on('snap.setType', (message) => {
      const { type, enabled, priority, tolerance } = message.data;
      
      if (!this.snapTypes[type]) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Unknown snap type: ${type}`
          });
        }
        return;
      }
      
      if (enabled !== undefined) this.snapTypes[type].enabled = !!enabled;
      if (priority !== undefined) this.snapTypes[type].priority = Math.max(1, Math.min(10, priority));
      if (tolerance !== undefined) this.snapTypes[type].tolerance = Math.max(1, tolerance);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: this.snapTypes[type]
        });
      }
      
      this.msg.emit('snap.typeChanged', {
        type,
        settings: this.snapTypes[type]
      });
    });

    // إضافة كائن هندسي
    this.msg.on('snap.addGeometry', (message) => {
      const { objectId, geometry } = message.data;
      
      try {
        this.addGeometry(objectId, geometry);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { objectId, added: true }
          });
        }
        
        this.msg.emit('snap.geometryAdded', { objectId });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // إزالة كائن هندسي
    this.msg.on('snap.removeGeometry', (message) => {
      const { objectId } = message.data;
      
      const removed = this.removeGeometry(objectId);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { objectId, removed }
        });
      }
      
      if (removed) {
        this.msg.emit('snap.geometryRemoved', { objectId });
      }
    });

    // البحث عن نقطة التقاط
    this.msg.on('snap.findSnapPoint', async (message) => {
      const { cursorPosition, viewport } = message.data;
      
      try {
        const snapResult = await this.findSnapPoint(cursorPosition, viewport);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: snapResult
          });
        }
        
        // تحديث الحالة الحالية
        if (snapResult.found) {
          this.currentSnap = {
            active: true,
            type: snapResult.type,
            point: snapResult.point,
            objectId: snapResult.objectId,
            tolerance: snapResult.tolerance
          };
          
          this.msg.emit('snap.pointFound', snapResult);
        } else {
          this.currentSnap.active = false;
          this.msg.emit('snap.pointLost', {});
        }
        
        this.stats.snapOperations++;
        if (snapResult.found) {
          this.stats.snapHits++;
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

    // الحصول على نقاط التقاط لمنطقة
    this.msg.on('snap.getSnapPoints', async (message) => {
      const { bounds, types } = message.data;
      
      try {
        const points = await this.getSnapPointsInBounds(bounds, types);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: points
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

    // مسح جميع الكائنات
    this.msg.on('snap.clearAll', (message) => {
      this.clearAll();
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { cleared: true }
        });
      }
      
      this.msg.emit('snap.cleared', {});
    });

    // معلومات الموديول
    this.msg.on('snap.info', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            version: this.version,
            enabled: this.config.enabled,
            config: this.config,
            types: this.snapTypes,
            objectsCount: this.geometryObjects.size,
            currentSnap: this.currentSnap,
            stats: this.stats
          }
        });
      }
    });
  }

  /**
   * تحديث الإعدادات
   */
  updateConfiguration(newConfig) {
    if (newConfig.tolerance !== undefined) {
      const tolerance = Number(newConfig.tolerance);
      if (isNaN(tolerance) || tolerance < 1) {
        throw new Error('Tolerance must be a positive number');
      }
      this.config.tolerance = tolerance;
    }
    
    if (newConfig.gridSize !== undefined) {
      const gridSize = Number(newConfig.gridSize);
      if (isNaN(gridSize) || gridSize <= 0) {
        throw new Error('Grid size must be a positive number');
      }
      this.config.gridSize = gridSize;
    }
    
    if (newConfig.showIndicators !== undefined) {
      this.config.showIndicators = !!newConfig.showIndicators;
    }
    
    if (newConfig.showTooltips !== undefined) {
      this.config.showTooltips = !!newConfig.showTooltips;
    }
  }

  /**
   * إضافة كائن هندسي
   */
  addGeometry(objectId, geometry) {
    if (!geometry || !geometry.type) {
      throw new Error('Invalid geometry data');
    }
    
    // تحويل الهندسة لتنسيق داخلي
    const processedGeometry = this.processGeometry(geometry);
    
    // حفظ الكائن
    this.geometryObjects.set(objectId, processedGeometry);
    
    // إضافة للفهرس المكاني
    this.addToSpatialIndex(objectId, processedGeometry);
    
    // مسح نقاط التقاط المحسوبة لإعادة الحساب
    this.invalidateSnapPoints();
  }

  /**
   * إزالة كائن هندسي
   */
  removeGeometry(objectId) {
    const geometry = this.geometryObjects.get(objectId);
    if (!geometry) return false;
    
    // إزالة من الخريطة الرئيسية
    this.geometryObjects.delete(objectId);
    
    // إزالة من الفهرس المكاني
    this.removeFromSpatialIndex(objectId, geometry);
    
    // مسح نقاط التقاط المحسوبة
    this.invalidateSnapPoints();
    
    return true;
  }

  /**
   * معالجة الهندسة لتنسيق داخلي
   */
  processGeometry(geometry) {
    const processed = {
      type: geometry.type,
      bounds: this.calculateBounds(geometry),
      data: { ...geometry }
    };
    
    // حساب نقاط خاصة حسب نوع الهندسة
    switch (geometry.type) {
      case 'line':
        processed.length = this.calculateLineLength(geometry);
        processed.midpoint = this.calculateLineMidpoint(geometry);
        break;
        
      case 'circle':
        processed.circumference = 2 * Math.PI * geometry.radius;
        processed.area = Math.PI * geometry.radius * geometry.radius;
        break;
        
      case 'arc':
        processed.length = geometry.radius * geometry.angle;
        processed.midpoint = this.calculateArcMidpoint(geometry);
        break;
        
      case 'rectangle':
        processed.area = geometry.width * geometry.height;
        processed.perimeter = 2 * (geometry.width + geometry.height);
        break;
    }
    
    return processed;
  }

  /**
   * البحث عن نقطة التقاط
   */
  async findSnapPoint(cursorPosition, viewport) {
    if (!this.config.enabled) {
      return { found: false };
    }
    
    // تحويل موقع المؤشر لإحداثيات العالم
    const worldPosition = await this.screenToWorld(cursorPosition, viewport);
    
    // البحث في منطقة التسامح
    const tolerance = this.config.tolerance;
    const searchBounds = {
      min: {
        x: worldPosition.x - tolerance,
        y: worldPosition.y - tolerance,
        z: worldPosition.z - tolerance
      },
      max: {
        x: worldPosition.x + tolerance,
        y: worldPosition.y + tolerance,
        z: worldPosition.z + tolerance
      }
    };
    
    // الحصول على الكائنات في المنطقة
    const candidateObjects = this.getObjectsInBounds(searchBounds);
    
    // البحث عن أفضل نقطة التقاط
    const candidates = [];
    
    for (const objectId of candidateObjects) {
      const geometry = this.geometryObjects.get(objectId);
      if (!geometry) continue;
      
      // البحث في جميع أنواع التقاط المفعلة
      for (const [type, settings] of Object.entries(this.snapTypes)) {
        if (!settings.enabled) continue;
        
        const snapPoints = this.findSnapPointsForGeometry(
          geometry, 
          type, 
          worldPosition, 
          settings.tolerance
        );
        
        for (const point of snapPoints) {
          const distance = this.calculateDistance(worldPosition, point.position);
          if (distance <= settings.tolerance) {
            candidates.push({
              type,
              point: point.position,
              objectId,
              distance,
              priority: settings.priority,
              tolerance: settings.tolerance,
              info: point.info || {}
            });
          }
        }
      }
    }
    
    // البحث في الشبكة
    if (this.snapTypes.grid.enabled) {
      const gridPoint = this.findGridSnapPoint(worldPosition);
      if (gridPoint) {
        const distance = this.calculateDistance(worldPosition, gridPoint);
        if (distance <= this.snapTypes.grid.tolerance) {
          candidates.push({
            type: 'grid',
            point: gridPoint,
            objectId: null,
            distance,
            priority: this.snapTypes.grid.priority,
            tolerance: this.snapTypes.grid.tolerance,
            info: { gridSize: this.config.gridSize }
          });
        }
      }
    }
    
    if (candidates.length === 0) {
      return { found: false };
    }
    
    // ترتيب حسب الأولوية ثم المسافة
    candidates.sort((a, b) => {
      if (a.priority !== b.priority) {
        return a.priority - b.priority;
      }
      return a.distance - b.distance;
    });
    
    // أفضل مرشح
    const best = candidates[0];
    
    return {
      found: true,
      type: best.type,
      point: best.point,
      objectId: best.objectId,
      distance: best.distance,
      tolerance: best.tolerance,
      info: best.info
    };
  }

  /**
   * البحث عن نقاط التقاط لهندسة محددة
   */
  findSnapPointsForGeometry(geometry, snapType, referencePoint, tolerance) {
    const cacheKey = `${geometry.type}_${snapType}_${JSON.stringify(geometry.bounds)}`;
    
    // فحص الكاش
    if (this.calculationCache.has(cacheKey)) {
      this.stats.cacheHits++;
      return this.calculationCache.get(cacheKey);
    }
    
    let points = [];
    
    switch (snapType) {
      case 'endpoint':
        points = this.findEndpoints(geometry);
        break;
        
      case 'midpoint':
        points = this.findMidpoints(geometry);
        break;
        
      case 'center':
        points = this.findCenters(geometry);
        break;
        
      case 'intersection':
        points = this.findIntersections(geometry, referencePoint, tolerance);
        break;
        
      case 'perpendicular':
        points = this.findPerpendicularPoints(geometry, referencePoint);
        break;
        
      case 'tangent':
        points = this.findTangentPoints(geometry, referencePoint);
        break;
        
      case 'nearest':
        points = this.findNearestPoints(geometry, referencePoint);
        break;
        
      case 'quadrant':
        points = this.findQuadrantPoints(geometry);
        break;
    }
    
    // إضافة للكاش
    if (this.calculationCache.size < this.maxCacheSize) {
      this.calculationCache.set(cacheKey, points);
    }
    
    return points;
  }

  /**
   * البحث عن نقاط النهاية
   */
  findEndpoints(geometry) {
    const points = [];
    
    switch (geometry.type) {
      case 'line':
        points.push(
          { position: geometry.data.start, info: { type: 'start' } },
          { position: geometry.data.end, info: { type: 'end' } }
        );
        break;
        
      case 'arc':
        const startAngle = geometry.data.startAngle;
        const endAngle = geometry.data.endAngle;
        const center = geometry.data.center;
        const radius = geometry.data.radius;
        
        points.push(
          {
            position: {
              x: center.x + radius * Math.cos(startAngle),
              y: center.y + radius * Math.sin(startAngle),
              z: center.z || 0
            },
            info: { type: 'start', angle: startAngle }
          },
          {
            position: {
              x: center.x + radius * Math.cos(endAngle),
              y: center.y + radius * Math.sin(endAngle),
              z: center.z || 0
            },
            info: { type: 'end', angle: endAngle }
          }
        );
        break;
        
      case 'polyline':
        if (geometry.data.points) {
          geometry.data.points.forEach((point, index) => {
            if (index === 0) {
              points.push({ position: point, info: { type: 'start', index } });
            } else if (index === geometry.data.points.length - 1) {
              points.push({ position: point, info: { type: 'end', index } });
            }
          });
        }
        break;
    }
    
    return points;
  }

  /**
   * البحث عن نقاط المنتصف
   */
  findMidpoints(geometry) {
    const points = [];
    
    switch (geometry.type) {
      case 'line':
        if (geometry.midpoint) {
          points.push({
            position: geometry.midpoint,
            info: { type: 'midpoint' }
          });
        }
        break;
        
      case 'arc':
        if (geometry.midpoint) {
          points.push({
            position: geometry.midpoint,
            info: { type: 'midpoint' }
          });
        }
        break;
        
      case 'rectangle':
        const rect = geometry.data;
        points.push({
          position: {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
            z: rect.z || 0
          },
          info: { type: 'center' }
        });
        break;
    }
    
    return points;
  }

  /**
   * البحث عن نقاط المركز
   */
  findCenters(geometry) {
    const points = [];
    
    switch (geometry.type) {
      case 'circle':
        points.push({
          position: geometry.data.center,
          info: { type: 'center', radius: geometry.data.radius }
        });
        break;
        
      case 'arc':
        points.push({
          position: geometry.data.center,
          info: { type: 'center', radius: geometry.data.radius }
        });
        break;
        
      case 'ellipse':
        points.push({
          position: geometry.data.center,
          info: { type: 'center' }
        });
        break;
    }
    
    return points;
  }

  /**
   * البحث عن نقطة التقاط الشبكة
   */
  findGridSnapPoint(worldPosition) {
    const gridSize = this.config.gridSize;
    
    return {
      x: Math.round(worldPosition.x / gridSize) * gridSize,
      y: Math.round(worldPosition.y / gridSize) * gridSize,
      z: Math.round(worldPosition.z / gridSize) * gridSize
    };
  }

  /**
   * إضافة للفهرس المكاني
   */
  addToSpatialIndex(objectId, geometry) {
    // إزالة من الفهرس القديم أولاً
    const oldGeometry = this.geometryObjects.get(objectId);
    if (oldGeometry) {
      this.removeFromSpatialIndex(objectId, oldGeometry);
    }
    
    const bounds = geometry.bounds;
    const minCell = this.worldToCell(bounds.min);
    const maxCell = this.worldToCell(bounds.max);
    
    for (let x = minCell.x; x <= maxCell.x; x++) {
      for (let y = minCell.y; y <= maxCell.y; y++) {
        const cellKey = `${x},${y}`;
        if (!this.spatialIndex.has(cellKey)) {
          this.spatialIndex.set(cellKey, new Set());
        }
        this.spatialIndex.get(cellKey).add(objectId);
      }
    }
  }

  /**
   * إزالة من الفهرس المكاني
   */
  removeFromSpatialIndex(objectId, geometry) {
    const bounds = geometry.bounds;
    const minCell = this.worldToCell(bounds.min);
    const maxCell = this.worldToCell(bounds.max);
    
    for (let x = minCell.x; x <= maxCell.x; x++) {
      for (let y = minCell.y; y <= maxCell.y; y++) {
        const cellKey = `${x},${y}`;
        const cell = this.spatialIndex.get(cellKey);
        if (cell) {
          cell.delete(objectId);
          if (cell.size === 0) {
            this.spatialIndex.delete(cellKey);
          }
        }
      }
    }
  }

  /**
   * الحصول على الكائنات في منطقة
   */
  getObjectsInBounds(bounds) {
    this.stats.spatialQueries++;
    
    const minCell = this.worldToCell(bounds.min);
    const maxCell = this.worldToCell(bounds.max);
    const objects = new Set();
    
    for (let x = minCell.x; x <= maxCell.x; x++) {
      for (let y = minCell.y; y <= maxCell.y; y++) {
        const cellKey = `${x},${y}`;
        const cell = this.spatialIndex.get(cellKey);
        if (cell) {
          cell.forEach(objectId => objects.add(objectId));
        }
      }
    }
    
    return objects;
  }

  /**
   * تحويل إحداثيات العالم لخلية الفهرس
   */
  worldToCell(worldPos) {
    return {
      x: Math.floor(worldPos.x / this.indexCellSize),
      y: Math.floor(worldPos.y / this.indexCellSize)
    };
  }

  /**
   * تحويل من إحداثيات الشاشة للعالم
   */
  async screenToWorld(screenPos, viewport) {
    try {
      const result = await this.msg.request('viewport.screenToWorld', {
        screenPosition: screenPos,
        viewportId: viewport?.id || 'main'
      });
      return result;
    } catch (error) {
      // Fallback إذا لم يكن viewport متاحاً
      console.warn('Viewport transformation not available, using direct mapping');
      return {
        x: screenPos.x,
        y: screenPos.y,
        z: screenPos.z || 0
      };
    }
  }

  /**
   * حساب المسافة بين نقطتين
   */
  calculateDistance(p1, p2) {
    const dx = p1.x - p2.x;
    const dy = p1.y - p2.y;
    const dz = (p1.z || 0) - (p2.z || 0);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  /**
   * حساب حدود الهندسة
   */
  calculateBounds(geometry) {
    switch (geometry.type) {
      case 'line':
        const start = geometry.start || { x: 0, y: 0, z: 0 };
        const end = geometry.end || { x: 0, y: 0, z: 0 };
        return {
          min: {
            x: Math.min(start.x, end.x),
            y: Math.min(start.y, end.y),
            z: Math.min(start.z || 0, end.z || 0)
          },
          max: {
            x: Math.max(start.x, end.x),
            y: Math.max(start.y, end.y),
            z: Math.max(start.z || 0, end.z || 0)
          }
        };
        
      case 'circle':
        const center = geometry.center || { x: 0, y: 0, z: 0 };
        const r = geometry.radius || 0;
        return {
          min: { x: center.x - r, y: center.y - r, z: (center.z || 0) - r },
          max: { x: center.x + r, y: center.y + r, z: (center.z || 0) + r }
        };
        
      case 'rectangle':
        const rect = geometry;
        return {
          min: { 
            x: rect.x || 0, 
            y: rect.y || 0, 
            z: rect.z || 0 
          },
          max: { 
            x: (rect.x || 0) + (rect.width || 0), 
            y: (rect.y || 0) + (rect.height || 0), 
            z: rect.z || 0 
          }
        };
        
      default:
        return {
          min: { x: -1000, y: -1000, z: -1000 },
          max: { x: 1000, y: 1000, z: 1000 }
        };
    }
  }

  /**
   * مسح نقاط التقاط المحسوبة
   */
  invalidateSnapPoints() {
    this.snapPoints.clear();
    this.calculationCache.clear();
    this.stats.lastUpdateTime = Date.now();
  }

  /**
   * مسح جميع البيانات
   */
  clearAll() {
    this.geometryObjects.clear();
    this.spatialIndex.clear();
    this.snapPoints.clear();
    this.calculationCache.clear();
    this.currentSnap.active = false;
  }

  // تنفيذ باقي الوظائف المساعدة
  calculateLineLength(geometry) {
    if (!geometry.start || !geometry.end) return 0;
    return this.calculateDistance(geometry.start, geometry.end);
  }

  calculateLineMidpoint(geometry) {
    if (!geometry.start || !geometry.end) return { x: 0, y: 0, z: 0 };
    return {
      x: (geometry.start.x + geometry.end.x) / 2,
      y: (geometry.start.y + geometry.end.y) / 2,
      z: ((geometry.start.z || 0) + (geometry.end.z || 0)) / 2
    };
  }

  calculateArcMidpoint(geometry) {
    if (!geometry.center || geometry.radius === undefined) return { x: 0, y: 0, z: 0 };
    const midAngle = (geometry.startAngle + geometry.endAngle) / 2;
    const center = geometry.center;
    const radius = geometry.radius;
    
    return {
      x: center.x + radius * Math.cos(midAngle),
      y: center.y + radius * Math.sin(midAngle),
      z: center.z || 0
    };
  }

  // TODO: تنفيذ باقي وظائف التقاط التقاطعات والخطوط العمودية والمماسات
  findIntersections(geometry, referencePoint, tolerance) { 
    // TODO: Implement intersection detection between geometries
    return []; 
  }
  
  findPerpendicularPoints(geometry, referencePoint) { 
    // TODO: Implement perpendicular points detection
    return []; 
  }
  
  findTangentPoints(geometry, referencePoint) { 
    // TODO: Implement tangent points detection
    return []; 
  }
  
  findNearestPoints(geometry, referencePoint) {
    // Simple implementation for nearest point on geometry
    const points = [];
    
    switch (geometry.type) {
      case 'line':
        // Find nearest point on line segment
        const nearestOnLine = this.nearestPointOnLine(
          geometry.data.start,
          geometry.data.end,
          referencePoint
        );
        points.push({
          position: nearestOnLine,
          info: { type: 'nearest' }
        });
        break;
        
      case 'circle':
        // Find nearest point on circle
        const center = geometry.data.center;
        const radius = geometry.data.radius;
        const dx = referencePoint.x - center.x;
        const dy = referencePoint.y - center.y;
        const distance = Math.sqrt(dx * dx + dy * dy);
        
        if (distance > 0) {
          points.push({
            position: {
              x: center.x + (dx / distance) * radius,
              y: center.y + (dy / distance) * radius,
              z: center.z || 0
            },
            info: { type: 'nearest' }
          });
        }
        break;
    }
    
    return points;
  }
  
  findQuadrantPoints(geometry) {
    const points = [];
    
    if (geometry.type === 'circle') {
      const center = geometry.data.center;
      const radius = geometry.data.radius;
      
      // Four quadrant points (0°, 90°, 180°, 270°)
      const angles = [0, Math.PI / 2, Math.PI, 3 * Math.PI / 2];
      
      angles.forEach((angle, index) => {
        points.push({
          position: {
            x: center.x + radius * Math.cos(angle),
            y: center.y + radius * Math.sin(angle),
            z: center.z || 0
          },
          info: { type: 'quadrant', angle: angle * 180 / Math.PI }
        });
      });
    }
    
    return points;
  }
  
  async getSnapPointsInBounds(bounds, types) {
    const points = [];
    const enabledTypes = types || Object.keys(this.snapTypes).filter(t => this.snapTypes[t].enabled);
    
    // Get objects in bounds
    const objects = this.getObjectsInBounds(bounds);
    
    for (const objectId of objects) {
      const geometry = this.geometryObjects.get(objectId);
      if (!geometry) continue;
      
      for (const type of enabledTypes) {
        if (!this.snapTypes[type]?.enabled) continue;
        
        const snapPoints = this.findSnapPointsForGeometry(
          geometry,
          type,
          null, // No reference point needed
          this.snapTypes[type].tolerance
        );
        
        snapPoints.forEach(point => {
          if (this.isPointInBounds(point.position, bounds)) {
            points.push({
              type,
              point: point.position,
              objectId,
              info: point.info
            });
          }
        });
      }
    }
    
    return points;
  }
  
  // Helper function: nearest point on line segment
  nearestPointOnLine(start, end, point) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = (end.z || 0) - (start.z || 0);
    
    const lengthSquared = dx * dx + dy * dy + dz * dz;
    
    if (lengthSquared === 0) {
      return start; // Start and end are the same
    }
    
    const t = Math.max(0, Math.min(1, 
      ((point.x - start.x) * dx + 
       (point.y - start.y) * dy + 
       ((point.z || 0) - (start.z || 0)) * dz) / lengthSquared
    ));
    
    return {
      x: start.x + t * dx,
      y: start.y + t * dy,
      z: (start.z || 0) + t * dz
    };
  }
  
  // Helper function: check if point is in bounds
  isPointInBounds(point, bounds) {
    return point.x >= bounds.min.x && point.x <= bounds.max.x &&
           point.y >= bounds.min.y && point.y <= bounds.max.y &&
           (point.z || 0) >= (bounds.min.z || 0) && (point.z || 0) <= (bounds.max.z || 0);
  }

  // دورة الحياة
  async start() {
    console.log('Snap Manager module started');
    console.log(`Snap types: ${Object.keys(this.snapTypes).join(', ')}`);
  }

  async stop() {
    this.clearAll();
  }

  async healthCheck() {
    return {
      healthy: true,
      enabled: this.config.enabled,
      objectsCount: this.geometryObjects.size,
      stats: this.stats
    };
  }

  async cleanup() {
    this.clearAll();
    this.msg.off('snap.*');
  }
}
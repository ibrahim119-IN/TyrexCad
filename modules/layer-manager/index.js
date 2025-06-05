/**
 * Layer Manager Module - مدير الطبقات المتقدم
 * @module LayerManagerModule
 * @version 1.0.0
 * 
 * مسؤول عن:
 * - إدارة الطبقات المتداخلة
 * - إعدادات الطبقات (لون، رؤية، قفل)
 * - تنظيم الكائنات في طبقات
 * - عمليات دفعية على الطبقات
 * - تصدير/استيراد إعدادات الطبقات
 */

export default class LayerManagerModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // الطبقات المنظمة كشجرة
    this.layers = new Map(); // layerId -> layer data
    this.layerHierarchy = new Map(); // parentId -> Set(childIds)
    this.rootLayers = new Set(); // طبقات الجذر
    
    // تعيين الكائنات للطبقات
    this.objectLayers = new Map(); // objectId -> layerId
    this.layerObjects = new Map(); // layerId -> Set(objectIds)
    
    // الطبقة النشطة
    this.activeLayerId = null;
    
    // الطبقة الافتراضية
    this.defaultLayer = {
      id: 'default',
      name: 'Default',
      color: '#ffffff',
      visible: true,
      locked: false,
      opacity: 1.0,
      lineWeight: 1,
      lineType: 'solid',
      description: 'Default layer for new objects',
      parentId: null,
      children: new Set(),
      metadata: {},
      createdAt: Date.now(),
      modifiedAt: Date.now()
    };
    
    // إعدادات افتراضية للطبقات الجديدة
    this.defaultLayerSettings = {
      color: '#ffffff',
      visible: true,
      locked: false,
      opacity: 1.0,
      lineWeight: 1,
      lineType: 'solid'
    };
    
    // الألوان المعرفة مسبقاً
    this.predefinedColors = [
      '#ff0000', '#00ff00', '#0000ff', '#ffff00', '#ff00ff', '#00ffff',
      '#ff8000', '#8000ff', '#0080ff', '#80ff00', '#ff0080', '#00ff80',
      '#ffffff', '#cccccc', '#808080', '#404040', '#000000'
    ];
    
    // أنواع الخطوط المدعومة
    this.lineTypes = [
      'solid', 'dashed', 'dotted', 'dashdot', 'dashdotdot'
    ];
    
    // إحصائيات
    this.stats = {
      totalLayers: 0,
      visibleLayers: 0,
      lockedLayers: 0,
      objectsCount: 0,
      lastOperation: null,
      operationsCount: 0
    };
    
    this.setupDefaultLayer();
    this.setupHandlers();
    
    // بث رسالة الجاهزية
    this.msg.emit('layers.ready', {
      version: this.version,
      defaultLayer: this.defaultLayer.id,
      activeLayer: this.activeLayerId
    });
  }

  setupDefaultLayer() {
    this.layers.set(this.defaultLayer.id, this.defaultLayer);
    this.rootLayers.add(this.defaultLayer.id);
    this.layerObjects.set(this.defaultLayer.id, new Set());
    this.activeLayerId = this.defaultLayer.id;
    this.stats.totalLayers = 1;
    this.stats.visibleLayers = 1;
  }

  setupHandlers() {
    // إنشاء طبقة جديدة
    this.msg.on('layers.create', (message) => {
      const { name, settings = {}, parentId } = message.data;
      
      try {
        const layer = this.createLayer(name, settings, parentId);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: layer
          });
        }
        
        this.msg.emit('layers.created', layer);
        this.updateStats();
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // حذف طبقة
    this.msg.on('layers.delete', (message) => {
      const { layerId, moveObjectsTo } = message.data;
      
      try {
        const result = this.deleteLayer(layerId, moveObjectsTo);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result
          });
        }
        
        this.msg.emit('layers.deleted', {
          layerId,
          objectsMoved: result.objectsMoved,
          childrenMoved: result.childrenMoved
        });
        this.updateStats();
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // تحديث إعدادات طبقة
    this.msg.on('layers.update', (message) => {
      const { layerId, updates } = message.data;
      
      try {
        const layer = this.updateLayer(layerId, updates);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: layer
          });
        }
        
        this.msg.emit('layers.updated', layer);
        this.updateStats();
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // تعيين الطبقة النشطة
    this.msg.on('layers.setActive', (message) => {
      const { layerId } = message.data;
      
      try {
        this.setActiveLayer(layerId);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { activeLayer: this.activeLayerId }
          });
        }
        
        this.msg.emit('layers.activeChanged', {
          layerId: this.activeLayerId
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

    // إضافة كائن لطبقة
    this.msg.on('layers.addObject', (message) => {
      const { objectId, layerId } = message.data;
      
      try {
        const targetLayerId = layerId || this.activeLayerId;
        this.addObjectToLayer(objectId, targetLayerId);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { objectId, layerId: targetLayerId }
          });
        }
        
        this.msg.emit('layers.objectAdded', {
          objectId,
          layerId: targetLayerId
        });
        this.updateStats();
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // إزالة كائن من طبقة
    this.msg.on('layers.removeObject', (message) => {
      const { objectId } = message.data;
      
      try {
        const layerId = this.removeObjectFromLayer(objectId);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { objectId, removedFrom: layerId }
          });
        }
        
        if (layerId) {
          this.msg.emit('layers.objectRemoved', {
            objectId,
            layerId
          });
          this.updateStats();
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

    // نقل كائن بين طبقات
    this.msg.on('layers.moveObject', (message) => {
      const { objectId, targetLayerId } = message.data;
      
      try {
        const result = this.moveObjectToLayer(objectId, targetLayerId);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result
          });
        }
        
        this.msg.emit('layers.objectMoved', result);
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // تشغيل/إيقاف رؤية طبقة
    this.msg.on('layers.setVisibility', (message) => {
      const { layerId, visible, includeChildren = false } = message.data;
      
      try {
        const affected = this.setLayerVisibility(layerId, visible, includeChildren);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { affected }
          });
        }
        
        this.msg.emit('layers.visibilityChanged', {
          layerId,
          visible,
          affected
        });
        this.updateStats();
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // قفل/إلغاء قفل طبقة
    this.msg.on('layers.setLock', (message) => {
      const { layerId, locked, includeChildren = false } = message.data;
      
      try {
        const affected = this.setLayerLock(layerId, locked, includeChildren);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { affected }
          });
        }
        
        this.msg.emit('layers.lockChanged', {
          layerId,
          locked,
          affected
        });
        this.updateStats();
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // الحصول على معلومات طبقة
    this.msg.on('layers.get', (message) => {
      const { layerId } = message.data;
      
      const layer = this.layers.get(layerId);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: !!layer,
          result: layer ? this.getLayerInfo(layer) : null,
          error: layer ? null : `Layer '${layerId}' not found`
        });
      }
    });

    // قائمة جميع الطبقات
    this.msg.on('layers.list', (message) => {
      const { includeHidden = true, format = 'flat' } = message.data;
      
      try {
        const layers = format === 'tree' 
          ? this.getLayersAsTree(includeHidden)
          : this.getLayersFlat(includeHidden);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: layers
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

    // الحصول على كائنات طبقة
    this.msg.on('layers.getObjects', (message) => {
      const { layerId, includeChildren = false } = message.data;
      
      try {
        const objects = this.getLayerObjects(layerId, includeChildren);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: objects
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

    // عمليات دفعية
    this.msg.on('layers.batchOperation', (message) => {
      const { operation, layerIds, settings } = message.data;
      
      try {
        const results = this.performBatchOperation(operation, layerIds, settings);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: results
          });
        }
        
        this.msg.emit('layers.batchCompleted', {
          operation,
          affected: results.affected,
          failed: results.failed
        });
        this.updateStats();
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // تصدير إعدادات الطبقات
    this.msg.on('layers.export', (message) => {
      const { format = 'json', includeObjects = false } = message.data;
      
      try {
        const exported = this.exportLayers(format, includeObjects);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: exported
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

    // استيراد إعدادات الطبقات
    this.msg.on('layers.import', (message) => {
      const { data, merge = false } = message.data;
      
      try {
        const result = this.importLayers(data, merge);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result
          });
        }
        
        this.msg.emit('layers.imported', result);
        this.updateStats();
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // معلومات الموديول
    this.msg.on('layers.info', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            version: this.version,
            activeLayer: this.activeLayerId,
            defaultLayer: this.defaultLayer.id,
            stats: this.stats,
            predefinedColors: this.predefinedColors,
            lineTypes: this.lineTypes
          }
        });
      }
    });
  }

  /**
   * إنشاء طبقة جديدة
   */
  createLayer(name, settings = {}, parentId = null) {
    if (!name || typeof name !== 'string') {
      throw new Error('Layer name is required');
    }
    
    // فحص الاسم المكرر
    for (const layer of this.layers.values()) {
      if (layer.name === name && layer.parentId === parentId) {
        throw new Error(`Layer '${name}' already exists in this level`);
      }
    }
    
    // فحص الطبقة الأب
    if (parentId && !this.layers.has(parentId)) {
      throw new Error(`Parent layer '${parentId}' not found`);
    }
    
    const layerId = `layer_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    const layer = {
      id: layerId,
      name,
      color: settings.color || this.defaultLayerSettings.color,
      visible: settings.visible !== undefined ? settings.visible : this.defaultLayerSettings.visible,
      locked: settings.locked !== undefined ? settings.locked : this.defaultLayerSettings.locked,
      opacity: settings.opacity !== undefined ? settings.opacity : this.defaultLayerSettings.opacity,
      lineWeight: settings.lineWeight || this.defaultLayerSettings.lineWeight,
      lineType: settings.lineType || this.defaultLayerSettings.lineType,
      description: settings.description || '',
      parentId,
      children: new Set(),
      metadata: settings.metadata || {},
      createdAt: Date.now(),
      modifiedAt: Date.now()
    };
    
    // التحقق من صحة الإعدادات
    this.validateLayerSettings(layer);
    
    // حفظ الطبقة
    this.layers.set(layerId, layer);
    this.layerObjects.set(layerId, new Set());
    
    // تحديث التسلسل الهرمي
    if (parentId) {
      const parent = this.layers.get(parentId);
      parent.children.add(layerId);
      parent.modifiedAt = Date.now();
      
      if (!this.layerHierarchy.has(parentId)) {
        this.layerHierarchy.set(parentId, new Set());
      }
      this.layerHierarchy.get(parentId).add(layerId);
    } else {
      this.rootLayers.add(layerId);
    }
    
    this.stats.lastOperation = 'create';
    this.stats.operationsCount++;
    
    return layer;
  }

  /**
   * حذف طبقة
   */
  deleteLayer(layerId, moveObjectsTo = null) {
    if (layerId === this.defaultLayer.id) {
      throw new Error('Cannot delete default layer');
    }
    
    const layer = this.layers.get(layerId);
    if (!layer) {
      throw new Error(`Layer '${layerId}' not found`);
    }
    
    // نقل الكائنات إذا طُلب
    const objects = this.layerObjects.get(layerId) || new Set();
    const targetLayer = moveObjectsTo || this.defaultLayer.id;
    
    if (moveObjectsTo && !this.layers.has(moveObjectsTo)) {
      throw new Error(`Target layer '${moveObjectsTo}' not found`);
    }
    
    // نقل الكائنات
    const objectsMoved = [];
    for (const objectId of objects) {
      this.moveObjectToLayer(objectId, targetLayer);
      objectsMoved.push(objectId);
    }
    
    // نقل الطبقات الفرعية
    const childrenMoved = [];
    const children = Array.from(layer.children);
    for (const childId of children) {
      const child = this.layers.get(childId);
      if (child) {
        child.parentId = layer.parentId;
        child.modifiedAt = Date.now();
        
        // تحديث التسلسل الهرمي
        if (layer.parentId) {
          const grandparent = this.layers.get(layer.parentId);
          grandparent.children.add(childId);
          
          if (!this.layerHierarchy.has(layer.parentId)) {
            this.layerHierarchy.set(layer.parentId, new Set());
          }
          this.layerHierarchy.get(layer.parentId).add(childId);
        } else {
          // نقل للجذر
          this.rootLayers.add(childId);
        }
        
        childrenMoved.push(childId);
      }
    }
    
    // إزالة من التسلسل الهرمي
    if (layer.parentId) {
      const parent = this.layers.get(layer.parentId);
      parent.children.delete(layerId);
      parent.modifiedAt = Date.now();
      
      const parentChildren = this.layerHierarchy.get(layer.parentId);
      if (parentChildren) {
        parentChildren.delete(layerId);
        if (parentChildren.size === 0) {
          this.layerHierarchy.delete(layer.parentId);
        }
      }
    } else {
      this.rootLayers.delete(layerId);
    }
    
    // حذف الطبقة
    this.layers.delete(layerId);
    this.layerObjects.delete(layerId);
    this.layerHierarchy.delete(layerId);
    
    // تحديث الطبقة النشطة إذا كانت المحذوفة
    if (this.activeLayerId === layerId) {
      this.activeLayerId = this.defaultLayer.id;
    }
    
    this.stats.lastOperation = 'delete';
    this.stats.operationsCount++;
    
    return {
      layerId,
      objectsMoved,
      childrenMoved
    };
  }

  /**
   * تحديث طبقة
   */
  updateLayer(layerId, updates) {
    const layer = this.layers.get(layerId);
    if (!layer) {
      throw new Error(`Layer '${layerId}' not found`);
    }
    
    // تحديث الخصائص المسموحة
    const allowedUpdates = [
      'name', 'color', 'visible', 'locked', 'opacity', 
      'lineWeight', 'lineType', 'description', 'metadata'
    ];
    
    for (const [key, value] of Object.entries(updates)) {
      if (allowedUpdates.includes(key)) {
        layer[key] = value;
      }
    }
    
    layer.modifiedAt = Date.now();
    
    // التحقق من صحة الإعدادات الجديدة
    this.validateLayerSettings(layer);
    
    this.stats.lastOperation = 'update';
    this.stats.operationsCount++;
    
    return layer;
  }

  /**
   * تعيين الطبقة النشطة
   */
  setActiveLayer(layerId) {
    if (!this.layers.has(layerId)) {
      throw new Error(`Layer '${layerId}' not found`);
    }
    
    this.activeLayerId = layerId;
    this.stats.lastOperation = 'setActive';
    this.stats.operationsCount++;
  }

  /**
   * إضافة كائن لطبقة
   */
  addObjectToLayer(objectId, layerId) {
    if (!this.layers.has(layerId)) {
      throw new Error(`Layer '${layerId}' not found`);
    }
    
    // إزالة من الطبقة الحالية إذا كان موجوداً
    this.removeObjectFromLayer(objectId);
    
    // إضافة للطبقة الجديدة
    this.objectLayers.set(objectId, layerId);
    this.layerObjects.get(layerId).add(objectId);
    
    // تحديث timestamp للطبقة
    const layer = this.layers.get(layerId);
    layer.modifiedAt = Date.now();
    
    this.stats.lastOperation = 'addObject';
    this.stats.operationsCount++;
  }

  /**
   * إزالة كائن من طبقة
   */
  removeObjectFromLayer(objectId) {
    const currentLayerId = this.objectLayers.get(objectId);
    if (!currentLayerId) return null;
    
    // إزالة من الخرائط
    this.objectLayers.delete(objectId);
    
    const layerObjects = this.layerObjects.get(currentLayerId);
    if (layerObjects) {
      layerObjects.delete(objectId);
    }
    
    // تحديث timestamp للطبقة
    const layer = this.layers.get(currentLayerId);
    if (layer) {
      layer.modifiedAt = Date.now();
    }
    
    this.stats.lastOperation = 'removeObject';
    this.stats.operationsCount++;
    
    return currentLayerId;
  }

  /**
   * نقل كائن بين طبقات
   */
  moveObjectToLayer(objectId, targetLayerId) {
    const sourceLayerId = this.removeObjectFromLayer(objectId);
    this.addObjectToLayer(objectId, targetLayerId);
    
    return {
      objectId,
      sourceLayerId,
      targetLayerId
    };
  }

  /**
   * ضبط رؤية طبقة
   */
  setLayerVisibility(layerId, visible, includeChildren = false) {
    const layer = this.layers.get(layerId);
    if (!layer) {
      throw new Error(`Layer '${layerId}' not found`);
    }
    
    const affected = [layerId];
    layer.visible = visible;
    layer.modifiedAt = Date.now();
    
    // تطبيق على الطبقات الفرعية
    if (includeChildren) {
      const children = this.getAllChildren(layerId);
      for (const childId of children) {
        const child = this.layers.get(childId);
        if (child) {
          child.visible = visible;
          child.modifiedAt = Date.now();
          affected.push(childId);
        }
      }
    }
    
    this.stats.lastOperation = 'setVisibility';
    this.stats.operationsCount++;
    
    return affected;
  }

  /**
   * ضبط قفل طبقة
   */
  setLayerLock(layerId, locked, includeChildren = false) {
    const layer = this.layers.get(layerId);
    if (!layer) {
      throw new Error(`Layer '${layerId}' not found`);
    }
    
    const affected = [layerId];
    layer.locked = locked;
    layer.modifiedAt = Date.now();
    
    // تطبيق على الطبقات الفرعية
    if (includeChildren) {
      const children = this.getAllChildren(layerId);
      for (const childId of children) {
        const child = this.layers.get(childId);
        if (child) {
          child.locked = locked;
          child.modifiedAt = Date.now();
          affected.push(childId);
        }
      }
    }
    
    this.stats.lastOperation = 'setLock';
    this.stats.operationsCount++;
    
    return affected;
  }

  /**
   * الحصول على معلومات طبقة
   */
  getLayerInfo(layer) {
    const objects = this.layerObjects.get(layer.id) || new Set();
    const children = Array.from(layer.children);
    
    return {
      ...layer,
      children,
      objectsCount: objects.size,
      isActive: layer.id === this.activeLayerId,
      isDefault: layer.id === this.defaultLayer.id
    };
  }

  /**
   * الحصول على جميع الطبقات (مسطحة)
   */
  getLayersFlat(includeHidden = true) {
    const layers = [];
    
    for (const layer of this.layers.values()) {
      if (includeHidden || layer.visible) {
        layers.push(this.getLayerInfo(layer));
      }
    }
    
    return layers.sort((a, b) => a.name.localeCompare(b.name));
  }

  /**
   * الحصول على الطبقات كشجرة
   */
  getLayersAsTree(includeHidden = true) {
    const buildTree = (parentId) => {
      const children = [];
      const childIds = parentId ? 
        (this.layerHierarchy.get(parentId) || new Set()) : 
        this.rootLayers;
      
      for (const childId of childIds) {
        const layer = this.layers.get(childId);
        if (layer && (includeHidden || layer.visible)) {
          const layerInfo = this.getLayerInfo(layer);
          layerInfo.children = buildTree(childId);
          children.push(layerInfo);
        }
      }
      
      return children.sort((a, b) => a.name.localeCompare(b.name));
    };
    
    return buildTree(null);
  }

  /**
   * الحصول على كائنات طبقة
   */
  getLayerObjects(layerId, includeChildren = false) {
    const layer = this.layers.get(layerId);
    if (!layer) {
      throw new Error(`Layer '${layerId}' not found`);
    }
    
    const objects = new Set(this.layerObjects.get(layerId) || []);
    
    if (includeChildren) {
      const children = this.getAllChildren(layerId);
      for (const childId of children) {
        const childObjects = this.layerObjects.get(childId) || new Set();
        childObjects.forEach(obj => objects.add(obj));
      }
    }
    
    return Array.from(objects);
  }

  /**
   * الحصول على جميع الطبقات الفرعية
   */
  getAllChildren(layerId) {
    const children = new Set();
    const toProcess = [layerId];
    
    while (toProcess.length > 0) {
      const currentId = toProcess.pop();
      const currentChildren = this.layerHierarchy.get(currentId) || new Set();
      
      for (const childId of currentChildren) {
        if (!children.has(childId)) {
          children.add(childId);
          toProcess.push(childId);
        }
      }
    }
    
    return children;
  }

  /**
   * عمليات دفعية
   */
  performBatchOperation(operation, layerIds, settings) {
    const results = {
      affected: [],
      failed: []
    };
    
    for (const layerId of layerIds) {
      try {
        switch (operation) {
          case 'setVisibility':
            this.setLayerVisibility(layerId, settings.visible, settings.includeChildren);
            results.affected.push(layerId);
            break;
            
          case 'setLock':
            this.setLayerLock(layerId, settings.locked, settings.includeChildren);
            results.affected.push(layerId);
            break;
            
          case 'updateProperties':
            this.updateLayer(layerId, settings);
            results.affected.push(layerId);
            break;
            
          case 'delete':
            this.deleteLayer(layerId, settings.moveObjectsTo);
            results.affected.push(layerId);
            break;
            
          default:
            throw new Error(`Unknown operation: ${operation}`);
        }
      } catch (error) {
        results.failed.push({
          layerId,
          error: error.message
        });
      }
    }
    
    return results;
  }

  /**
   * تصدير الطبقات
   */
  exportLayers(format = 'json', includeObjects = false) {
    const data = {
      version: this.version,
      exportedAt: Date.now(),
      activeLayer: this.activeLayerId,
      layers: {},
      hierarchy: {},
      objects: includeObjects ? {} : null
    };
    
    // تصدير الطبقات
    for (const [id, layer] of this.layers) {
      data.layers[id] = {
        ...layer,
        children: Array.from(layer.children)
      };
    }
    
    // تصدير التسلسل الهرمي
    for (const [parentId, children] of this.layerHierarchy) {
      data.hierarchy[parentId] = Array.from(children);
    }
    
    // تصدير تعيين الكائنات
    if (includeObjects) {
      for (const [objectId, layerId] of this.objectLayers) {
        data.objects[objectId] = layerId;
      }
    }
    
    return format === 'json' ? JSON.stringify(data, null, 2) : data;
  }

  /**
   * التحقق من توافق الإصدار
   */
  isCompatibleVersion(version) {
    if (!version) return true;
    const [major] = version.split('.');
    const [currentMajor] = this.version.split('.');
    return major === currentMajor;
  }

  /**
   * استيراد الطبقات
   */
  importLayers(importData, merge = false) {
    let data;
    try {
      data = typeof importData === 'string' ? JSON.parse(importData) : importData;
    } catch (error) {
      throw new Error('Invalid JSON data');
    }
    
    // Validation
    if (!data || typeof data !== 'object') {
      throw new Error('Invalid import data');
    }
    
    if (!data.layers || typeof data.layers !== 'object') {
      throw new Error('Missing or invalid layers data');
    }
    
    // التحقق من الإصدار
    if (data.version && !this.isCompatibleVersion(data.version)) {
      console.warn(`Import data version ${data.version} may not be fully compatible with ${this.version}`);
    }
    
    if (!merge) {
      // مسح الطبقات الحالية (ما عدا الافتراضية)
      for (const layerId of this.layers.keys()) {
        if (layerId !== this.defaultLayer.id) {
          this.deleteLayer(layerId);
        }
      }
    }
    
    const imported = {
      layers: 0,
      objects: 0,
      errors: []
    };
    
    // استيراد الطبقات
    for (const [id, layerData] of Object.entries(data.layers)) {
      if (id === this.defaultLayer.id && merge) continue;
      
      try {
        const layer = {
          ...layerData,
          children: new Set(layerData.children || [])
        };
        
        this.layers.set(id, layer);
        this.layerObjects.set(id, new Set());
        imported.layers++;
        
      } catch (error) {
        imported.errors.push({
          type: 'layer',
          id,
          error: error.message
        });
      }
    }
    
    // استيراد التسلسل الهرمي
    this.layerHierarchy.clear();
    this.rootLayers.clear();
    
    for (const [parentId, children] of Object.entries(data.hierarchy || {})) {
      this.layerHierarchy.set(parentId, new Set(children));
    }
    
    // تحديد طبقات الجذر
    for (const layerId of this.layers.keys()) {
      const layer = this.layers.get(layerId);
      if (!layer.parentId) {
        this.rootLayers.add(layerId);
      }
    }
    
    // استيراد تعيين الكائنات
    if (data.objects) {
      for (const [objectId, layerId] of Object.entries(data.objects)) {
        if (this.layers.has(layerId)) {
          this.objectLayers.set(objectId, layerId);
          this.layerObjects.get(layerId).add(objectId);
          imported.objects++;
        }
      }
    }
    
    // تعيين الطبقة النشطة
    if (data.activeLayer && this.layers.has(data.activeLayer)) {
      this.activeLayerId = data.activeLayer;
    }
    
    return imported;
  }

  /**
   * التحقق من صحة إعدادات الطبقة
   */
  validateLayerSettings(layer) {
    // فحص اللون
    if (!/^#[0-9A-F]{6}$/i.test(layer.color)) {
      throw new Error('Invalid color format. Use #RRGGBB');
    }
    
    // فحص الشفافية
    if (layer.opacity < 0 || layer.opacity > 1) {
      throw new Error('Opacity must be between 0 and 1');
    }
    
    // فحص سماكة الخط
    if (layer.lineWeight < 0.1 || layer.lineWeight > 10) {
      throw new Error('Line weight must be between 0.1 and 10');
    }
    
    // فحص نوع الخط
    if (!this.lineTypes.includes(layer.lineType)) {
      throw new Error(`Invalid line type. Supported: ${this.lineTypes.join(', ')}`);
    }
  }

  /**
   * تحديث الإحصائيات
   */
  updateStats() {
    this.stats.totalLayers = this.layers.size;
    this.stats.visibleLayers = Array.from(this.layers.values())
      .filter(layer => layer.visible).length;
    this.stats.lockedLayers = Array.from(this.layers.values())
      .filter(layer => layer.locked).length;
    this.stats.objectsCount = this.objectLayers.size;
  }

  // دورة الحياة
  async start() {
    console.log('Layer Manager module started');
    console.log(`Active layer: ${this.activeLayerId}`);
    this.updateStats();
  }

  async stop() {
    console.log('Layer Manager module stopped');
  }

  async healthCheck() {
    return {
      healthy: true,
      layersCount: this.layers.size,
      activeLayer: this.activeLayerId,
      stats: this.stats
    };
  }

  async cleanup() {
    this.layers.clear();
    this.layerHierarchy.clear();
    this.rootLayers.clear();
    this.objectLayers.clear();
    this.layerObjects.clear();
    this.msg.off('layers.*');
  }
}
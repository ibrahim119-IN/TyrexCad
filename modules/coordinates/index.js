/**
 * Coordinate System Module - نظام الإحداثيات والوحدات
 * @module CoordinatesModule
 * @version 1.0.0
 * 
 * مسؤول عن:
 * - تحويل الوحدات (مم، سم، بوصة، إلخ)
 * - تحويل أنظمة الإحداثيات (كارتيزية، قطبية، إسطوانية)
 * - الدقة والضبط
 * - النقاط المرجعية
 */

export default class CoordinatesModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // الوحدة الافتراضية (مليمتر)
    this.baseUnit = 'mm';
    
    // دقة الحسابات (عدد الأرقام العشرية)
    this.precision = 6;
    
    // نظام الإحداثيات الافتراضي
    this.defaultCoordinateSystem = 'cartesian';
    
    // نقطة الأصل العامة
    this.worldOrigin = { x: 0, y: 0, z: 0 };
    
    // النقاط المرجعية المحفوظة
    this.referencePoints = new Map();
    
    // إعدادات التحليل والتحويل
    this.parseSettings = {
      angleMeasure: 'radians', // افتراضي
      coordinateSystem: 'cartesian',
      precision: 6,
      strictMode: false
    };
    
    // تحويلات الوحدات إلى الوحدة الأساسية (مليمتر)
    this.unitConversions = {
      // Metric units
      'mm': 1.0,           // millimeter (base)
      'cm': 10.0,          // centimeter
      'm': 1000.0,         // meter
      'km': 1000000.0,     // kilometer
      'μm': 0.001,         // micrometer
      'nm': 0.000001,      // nanometer
      
      // Imperial units
      'in': 25.4,          // inch
      'ft': 304.8,         // foot
      'yd': 914.4,         // yard
      'mil': 0.0254,       // mil (1/1000 inch)
      
      // Other units
      'pt': 0.352778,      // point (typography)
      'pc': 4.233333,      // pica
      'angstrom': 0.0000001 // angstrom
    };
    
    // إحصائيات
    this.stats = {
      conversions: 0,
      transforms: 0,
      referencePoints: 0,
      precisionOperations: 0
    };
    
    this.setupHandlers();
    
    // بث رسالة الجاهزية
    this.msg.emit('coordinates.ready', {
      version: this.version,
      baseUnit: this.baseUnit,
      precision: this.precision,
      supportedUnits: Object.keys(this.unitConversions)
    });
  }

  setupHandlers() {
    // تحويل وحدة
    this.msg.on('coordinates.convertUnit', (message) => {
      const { value, fromUnit, toUnit } = message.data;
      
      try {
        const result = this.convertUnit(value, fromUnit, toUnit);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: {
              original: { value, unit: fromUnit },
              converted: { value: result, unit: toUnit },
              conversion: this.getConversionRatio(fromUnit, toUnit)
            }
          });
        }
        
        this.stats.conversions++;
        this.msg.emit('coordinates.unitConverted', {
          from: { value, unit: fromUnit },
          to: { value: result, unit: toUnit }
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

    // تحويل نظام إحداثيات
    this.msg.on('coordinates.transform', (message) => {
      const { coordinates, fromSystem, toSystem } = message.data;
      
      try {
        const result = this.transformCoordinates(coordinates, fromSystem, toSystem);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: {
              original: { coordinates, system: fromSystem },
              transformed: { coordinates: result, system: toSystem }
            }
          });
        }
        
        this.stats.transforms++;
        this.msg.emit('coordinates.transformed', {
          from: { coordinates, system: fromSystem },
          to: { coordinates: result, system: toSystem }
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

    // ضبط الدقة
    this.msg.on('coordinates.setPrecision', (message) => {
      const { precision } = message.data;
      
      if (typeof precision !== 'number' || precision < 0 || precision > 15) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: 'Precision must be a number between 0 and 15'
          });
        }
        return;
      }
      
      this.precision = precision;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { precision: this.precision }
        });
      }
      
      this.msg.emit('coordinates.precisionChanged', {
        precision: this.precision
      });
    });

    // تطبيق الدقة على رقم
    this.msg.on('coordinates.applyPrecision', (message) => {
      const { value, customPrecision } = message.data;
      
      try {
        const precision = customPrecision !== undefined ? customPrecision : this.precision;
        const result = this.applyPrecision(value, precision);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: result
          });
        }
        
        this.stats.precisionOperations++;
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // حفظ نقطة مرجعية
    this.msg.on('coordinates.saveReference', (message) => {
      const { name, coordinates, description = '' } = message.data;
      
      if (!name || !coordinates) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: 'Name and coordinates are required'
          });
        }
        return;
      }
      
      const referencePoint = {
        name,
        coordinates: this.normalizeCoordinates(coordinates),
        description,
        createdAt: Date.now(),
        id: `ref_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
      };
      
      this.referencePoints.set(name, referencePoint);
      this.stats.referencePoints++;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: referencePoint
        });
      }
      
      this.msg.emit('coordinates.referenceSaved', referencePoint);
    });

    // الحصول على نقطة مرجعية
    this.msg.on('coordinates.getReference', (message) => {
      const { name } = message.data;
      
      const referencePoint = this.referencePoints.get(name);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: !!referencePoint,
          result: referencePoint || null,
          error: referencePoint ? null : `Reference point '${name}' not found`
        });
      }
    });

    // قائمة النقاط المرجعية
    this.msg.on('coordinates.listReferences', (message) => {
      const references = Array.from(this.referencePoints.values());
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: references
        });
      }
    });

    // حذف نقطة مرجعية
    this.msg.on('coordinates.deleteReference', (message) => {
      const { name } = message.data;
      
      const existed = this.referencePoints.has(name);
      this.referencePoints.delete(name);
      
      if (existed) {
        this.stats.referencePoints--;
      }
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { deleted: existed, name }
        });
      }
      
      if (existed) {
        this.msg.emit('coordinates.referenceDeleted', { name });
      }
    });

    // حساب المسافة بين نقطتين
    this.msg.on('coordinates.distance', (message) => {
      const { point1, point2, unit = this.baseUnit } = message.data;
      
      try {
        const distance = this.calculateDistance(point1, point2);
        const convertedDistance = this.convertUnit(distance, this.baseUnit, unit);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: {
              distance: convertedDistance,
              unit,
              baseDistance: distance,
              baseUnit: this.baseUnit
            }
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

    // معلومات الموديول
    this.msg.on('coordinates.info', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            version: this.version,
            baseUnit: this.baseUnit,
            precision: this.precision,
            supportedUnits: Object.keys(this.unitConversions),
            referencePointsCount: this.referencePoints.size,
            stats: this.stats
          }
        });
      }
    });
  }

  /**
   * تحويل وحدة
   */
  convertUnit(value, fromUnit, toUnit) {
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error('Value must be a valid number');
    }
    
    if (!this.unitConversions[fromUnit]) {
      throw new Error(`Unsupported unit: ${fromUnit}`);
    }
    
    if (!this.unitConversions[toUnit]) {
      throw new Error(`Unsupported unit: ${toUnit}`);
    }
    
    if (fromUnit === toUnit) {
      return value;
    }
    
    // تحويل إلى الوحدة الأساسية أولاً
    const baseValue = value * this.unitConversions[fromUnit];
    
    // ثم إلى الوحدة المطلوبة
    const result = baseValue / this.unitConversions[toUnit];
    
    return this.applyPrecision(result);
  }

  /**
   * الحصول على نسبة التحويل بين وحدتين
   */
  getConversionRatio(fromUnit, toUnit) {
    if (!this.unitConversions[fromUnit] || !this.unitConversions[toUnit]) {
      return null;
    }
    
    return this.unitConversions[fromUnit] / this.unitConversions[toUnit];
  }

  /**
   * تحويل أنظمة الإحداثيات
   */
  transformCoordinates(coordinates, fromSystem, toSystem) {
    if (fromSystem === toSystem) {
      return coordinates;
    }
    
    // Cartesian to Polar
    if (fromSystem === 'cartesian' && toSystem === 'polar') {
      return this.cartesianToPolar(coordinates);
    }
    
    // Polar to Cartesian
    if (fromSystem === 'polar' && toSystem === 'cartesian') {
      return this.polarToCartesian(coordinates);
    }
    
    // Cartesian to Cylindrical
    if (fromSystem === 'cartesian' && toSystem === 'cylindrical') {
      return this.cartesianToCylindrical(coordinates);
    }
    
    // Cylindrical to Cartesian
    if (fromSystem === 'cylindrical' && toSystem === 'cartesian') {
      return this.cylindricalToCartesian(coordinates);
    }
    
    // Cartesian to Spherical
    if (fromSystem === 'cartesian' && toSystem === 'spherical') {
      return this.cartesianToSpherical(coordinates);
    }
    
    // Spherical to Cartesian
    if (fromSystem === 'spherical' && toSystem === 'cartesian') {
      return this.sphericalToCartesian(coordinates);
    }
    
    throw new Error(`Conversion from ${fromSystem} to ${toSystem} not supported`);
  }

  /**
   * كارتيزية إلى قطبية
   */
  cartesianToPolar(coords) {
    const { x, y, z = 0 } = this.normalizeCoordinates(coords);
    
    const r = Math.sqrt(x * x + y * y);
    const theta = Math.atan2(y, x);
    
    return {
      r: this.applyPrecision(r),
      theta: this.applyPrecision(theta),
      z: this.applyPrecision(z)
    };
  }

  /**
   * قطبية إلى كارتيزية
   */
  polarToCartesian(coords) {
    const { r, theta, z = 0 } = coords;
    
    // تحويل الزاوية إذا كانت بالدرجات
    const angleInRadians = this.parseSettings?.angleMeasure === 'degrees' 
      ? theta * Math.PI / 180 
      : theta;
    
    const x = r * Math.cos(angleInRadians);
    const y = r * Math.sin(angleInRadians);
    
    return {
      x: this.applyPrecision(x),
      y: this.applyPrecision(y),
      z: this.applyPrecision(z)
    };
  }

  /**
   * كارتيزية إلى أسطوانية
   */
  cartesianToCylindrical(coords) {
    const { x, y, z } = this.normalizeCoordinates(coords);
    
    const rho = Math.sqrt(x * x + y * y);
    const phi = Math.atan2(y, x);
    
    return {
      rho: this.applyPrecision(rho),
      phi: this.applyPrecision(phi),
      z: this.applyPrecision(z)
    };
  }

  /**
   * أسطوانية إلى كارتيزية
   */
  cylindricalToCartesian(coords) {
    const { rho, phi, z } = coords;
    
    const x = rho * Math.cos(phi);
    const y = rho * Math.sin(phi);
    
    return {
      x: this.applyPrecision(x),
      y: this.applyPrecision(y),
      z: this.applyPrecision(z)
    };
  }

  /**
   * كارتيزية إلى كروية
   */
  cartesianToSpherical(coords) {
    const { x, y, z } = this.normalizeCoordinates(coords);
    
    const r = Math.sqrt(x * x + y * y + z * z);
    
    // معالجة الحالة الخاصة عند r = 0
    if (r === 0) {
      return {
        r: 0,
        theta: 0,
        phi: 0
      };
    }
    
    const theta = Math.atan2(y, x);
    const phi = Math.acos(Math.max(-1, Math.min(1, z / r))); // clamp لتجنب أخطاء acos
    
    return {
      r: this.applyPrecision(r),
      theta: this.applyPrecision(theta),
      phi: this.applyPrecision(phi)
    };
  }

  /**
   * كروية إلى كارتيزية
   */
  sphericalToCartesian(coords) {
    const { r, theta, phi } = coords;
    
    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);
    
    return {
      x: this.applyPrecision(x),
      y: this.applyPrecision(y),
      z: this.applyPrecision(z)
    };
  }

  /**
   * تطبيق الدقة على رقم
   */
  applyPrecision(value, customPrecision = null) {
    const precision = customPrecision !== null ? customPrecision : this.precision;
    return Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
  }

  /**
   * تطبيع الإحداثيات
   */
  normalizeCoordinates(coords) {
    if (Array.isArray(coords)) {
      return {
        x: coords[0] || 0,
        y: coords[1] || 0,
        z: coords[2] || 0
      };
    }
    
    return {
      x: coords.x || 0,
      y: coords.y || 0,
      z: coords.z || 0
    };
  }

  /**
   * حساب المسافة بين نقطتين
   */
  calculateDistance(point1, point2) {
    const p1 = this.normalizeCoordinates(point1);
    const p2 = this.normalizeCoordinates(point2);
    
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const dz = p2.z - p1.z;
    
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // دورة الحياة
  async start() {
    console.log('Coordinates module started');
    console.log(`Base unit: ${this.baseUnit}, Precision: ${this.precision}`);
  }

  async stop() {
    console.log('Coordinates module stopped');
  }

  async healthCheck() {
    return {
      healthy: true,
      referencePoints: this.referencePoints.size,
      stats: this.stats
    };
  }

  async cleanup() {
    this.referencePoints.clear();
    this.msg.off('coordinates.*');
  }
}
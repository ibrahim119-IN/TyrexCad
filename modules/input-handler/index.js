/**
 * Input Handler Module - معالج الإدخال الذكي
 * @module InputHandlerModule
 * @version 1.0.0
 * 
 * مسؤول عن:
 * - تحليل وفهم المدخلات النصية
 * - دعم أنواع الإحداثيات المختلفة
 * - العمليات الحسابية في المدخلات
 * - المتغيرات والثوابت
 * - التحقق من صحة المدخلات
 * - التصحيح التلقائي والاقتراحات
 */

export default class InputHandlerModule {
  constructor(messageAPI) {
    this.msg = messageAPI;
    this.version = '1.0.0';
    
    // المتغيرات المحفوظة
    this.variables = new Map();
    
    // الثوابت المعرفة مسبقاً
    this.constants = new Map([
      ['PI', Math.PI],
      ['E', Math.E],
      ['SQRT2', Math.SQRT2],
      ['SQRT1_2', Math.SQRT1_2],
      ['LN2', Math.LN2],
      ['LN10', Math.LN10],
      ['LOG2E', Math.LOG2E],
      ['LOG10E', Math.LOG10E]
    ]);
    
    // تاريخ المدخلات للإكمال التلقائي
    this.inputHistory = [];
    this.maxHistorySize = 100;
    
    // النقطة الأخيرة المستخدمة (للإحداثيات النسبية)
    this.lastPoint = { x: 0, y: 0, z: 0 };
    
    // وحدة القياس الحالية
    this.currentUnit = 'mm';
    
    // إعدادات التحليل
    this.parseSettings = {
      angleMeasure: 'degrees', // 'degrees' or 'radians'
      coordinateSystem: 'cartesian',
      precision: 6,
      strictMode: false // في الوضع الصارم، يرفض المدخلات الغامضة
    };
    
    // أنماط regex للتحليل
    this.patterns = {
      // الإحداثيات الكارتيزية: "10,20" أو "10,20,30"
      cartesian: /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?))?$/,
      
      // الإحداثيات النسبية: "@10,20" أو "@10,20,30"
      relative: /^@(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*(?:,\s*(-?\d+(?:\.\d+)?))?$/,
      
      // الإحداثيات القطبية: "@50<45" أو "50<45"
      polar: /^@?(-?\d+(?:\.\d+)?)\s*<\s*(-?\d+(?:\.\d+)?)$/,
      
      // المسافة فقط: "100" أو "@100"
      distance: /^@?(-?\d+(?:\.\d+)?)$/,
      
      // العمليات الحسابية: "100+50", "PI*2", "sqrt(100)"
      expression: /^(.+)$/,
      
      // المتغيرات: "width", "height", "$var1"
      variable: /^[a-zA-Z_$][a-zA-Z0-9_$]*$/,
      
      // الوحدات: "100mm", "5.5in", "2.5'"
      withUnit: /^(-?\d+(?:\.\d+)?)\s*([a-zA-Z'"]+)$/,
      
      // المعادلات: "x=100", "width=height*2"
      assignment: /^([a-zA-Z_$][a-zA-Z0-9_$]*)\s*=\s*(.+)$/
    };
    
    // الوحدات المدعومة
    this.supportedUnits = {
      'mm': 1.0,
      'cm': 10.0,
      'm': 1000.0,
      'in': 25.4,
      '"': 25.4,
      'ft': 304.8,
      "'": 304.8,
      'yd': 914.4,
      'pt': 0.352778,
      'pc': 4.233333
    };
    
    // الدوال المدعومة
    this.functions = new Map([
      ['abs', Math.abs],
      ['ceil', Math.ceil],
      ['floor', Math.floor],
      ['round', Math.round],
      ['sqrt', Math.sqrt],
      ['pow', Math.pow],
      ['sin', Math.sin],
      ['cos', Math.cos],
      ['tan', Math.tan],
      ['asin', Math.asin],
      ['acos', Math.acos],
      ['atan', Math.atan],
      ['atan2', Math.atan2],
      ['log', Math.log],
      ['exp', Math.exp],
      ['min', Math.min],
      ['max', Math.max],
      ['random', Math.random]
    ]);
    
    // إحصائيات
    this.stats = {
      totalInputs: 0,
      successfulParses: 0,
      errors: 0,
      variablesUsed: 0,
      calculationsPerformed: 0,
      lastInputTime: 0
    };
    
    this.setupHandlers();
    
    // بث رسالة الجاهزية
    this.msg.emit('input.ready', {
      version: this.version,
      currentUnit: this.currentUnit,
      supportedTypes: Object.keys(this.patterns)
    });
  }

  /**
   * تنظيف المدخل للعرض الآمن
   */
  sanitizeForDisplay(input) {
    return String(input)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#x27;')
      .replace(/\//g, '&#x2F;');
  }

  setupHandlers() {
    // تحليل مدخل
    this.msg.on('input.parse', (message) => {
      const { input, context = {}, options = {} } = message.data;
      
      try {
        const result = this.parseInput(input, context, options);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result
          });
        }
        
        this.stats.totalInputs++;
        this.stats.successfulParses++;
        this.stats.lastInputTime = Date.now();
        
        // إضافة للتاريخ
        this.addToHistory(input, result);
        
        this.msg.emit('input.parsed', {
          input,
          result,
          context
        });
        
      } catch (error) {
        this.stats.totalInputs++;
        this.stats.errors++;
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message,
            suggestions: this.getSuggestions(input)
          });
        }
        
        this.msg.emit('input.error', {
          input,
          error: error.message,
          suggestions: this.getSuggestions(input)
        });
      }
    });

    // ضبط متغير
    this.msg.on('input.setVariable', (message) => {
      const { name, value, description = '' } = message.data;
      
      try {
        this.setVariable(name, value, description);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: { name, value, description }
          });
        }
        
        this.msg.emit('input.variableSet', { name, value, description });
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // الحصول على متغير
    this.msg.on('input.getVariable', (message) => {
      const { name } = message.data;
      
      const variable = this.variables.get(name);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: !!variable,
          result: variable || null,
          error: variable ? null : `Variable '${name}' not found`
        });
      }
    });

    // قائمة المتغيرات
    this.msg.on('input.listVariables', (message) => {
      const variables = Array.from(this.variables.entries()).map(([name, data]) => ({
        name,
        ...data
      }));
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: variables
        });
      }
    });

    // حذف متغير
    this.msg.on('input.deleteVariable', (message) => {
      const { name } = message.data;
      
      const existed = this.variables.has(name);
      this.variables.delete(name);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { name, deleted: existed }
        });
      }
      
      if (existed) {
        this.msg.emit('input.variableDeleted', { name });
      }
    });

    // ضبط الوحدة الحالية
    this.msg.on('input.setUnit', (message) => {
      const { unit } = message.data;
      
      if (!this.supportedUnits[unit]) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: `Unsupported unit: ${unit}`
          });
        }
        return;
      }
      
      this.currentUnit = unit;
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: { unit: this.currentUnit }
        });
      }
      
      this.msg.emit('input.unitChanged', { unit: this.currentUnit });
    });

    // تحديث إعدادات التحليل
    this.msg.on('input.configure', (message) => {
      const { settings } = message.data;
      
      try {
        this.updateParseSettings(settings);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result: this.parseSettings
          });
        }
        
        this.msg.emit('input.configured', this.parseSettings);
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // اقتراحات للإكمال التلقائي
    this.msg.on('input.getSuggestions', (message) => {
      const { partial, context = {} } = message.data;
      
      const suggestions = this.getAutocompleteSuggestions(partial, context);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: suggestions
        });
      }
    });

    // تاريخ المدخلات
    this.msg.on('input.getHistory', (message) => {
      const { limit = 10 } = message.data;
      
      const history = this.inputHistory.slice(-limit);
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: history
        });
      }
    });

    // تقييم تعبير رياضي
    this.msg.on('input.evaluate', (message) => {
      const { expression, variables = {} } = message.data;
      
      try {
        const result = this.evaluateExpression(expression, variables);
        
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result
          });
        }
        
        this.stats.calculationsPerformed++;
        
      } catch (error) {
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });

    // ضبط النقطة الأخيرة
    this.msg.on('input.setLastPoint', (message) => {
      const { point } = message.data;
      
      this.lastPoint = {
        x: point.x || 0,
        y: point.y || 0,
        z: point.z || 0
      };
      
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: this.lastPoint
        });
      }
    });

    // معلومات الموديول
    this.msg.on('input.info', (message) => {
      if (message.requestId) {
        this.msg.reply(message.requestId, {
          success: true,
          result: {
            version: this.version,
            currentUnit: this.currentUnit,
            lastPoint: this.lastPoint,
            variablesCount: this.variables.size,
            constantsCount: this.constants.size,
            functionsCount: this.functions.size,
            supportedUnits: Object.keys(this.supportedUnits),
            settings: this.parseSettings,
            stats: this.stats
          }
        });
      }
    });
  }

  /**
   * تحليل المدخل الرئيسي
   */
  parseInput(input, context = {}, options = {}) {
    if (!input || typeof input !== 'string') {
      throw new Error('Input must be a non-empty string');
    }
    
    const trimmedInput = input.trim();
    if (!trimmedInput) {
      throw new Error('Input cannot be empty');
    }
    
    // دمج الخيارات مع الإعدادات الافتراضية
    const parseOptions = {
      ...this.parseSettings,
      ...options
    };
    
    // فحص نمط التعيين أولاً
    const assignmentMatch = trimmedInput.match(this.patterns.assignment);
    if (assignmentMatch) {
      return this.parseAssignment(assignmentMatch[1], assignmentMatch[2], parseOptions);
    }
    
    // تحديد نوع المدخل وتحليله
    const inputType = this.detectInputType(trimmedInput);
    
    switch (inputType) {
      case 'cartesian':
        return this.parseCartesianCoordinates(trimmedInput, parseOptions);
        
      case 'relative':
        return this.parseRelativeCoordinates(trimmedInput, parseOptions);
        
      case 'polar':
        return this.parsePolarCoordinates(trimmedInput, parseOptions);
        
      case 'distance':
        return this.parseDistance(trimmedInput, parseOptions);
        
      case 'variable':
        return this.parseVariable(trimmedInput, parseOptions);
        
      case 'withUnit':
        return this.parseValueWithUnit(trimmedInput, parseOptions);
        
      case 'expression':
        return this.parseExpression(trimmedInput, parseOptions);
        
      default:
        throw new Error(`Cannot determine input type for: ${trimmedInput}`);
    }
  }

  /**
   * تحديد نوع المدخل
   */
  detectInputType(input) {
    for (const [type, pattern] of Object.entries(this.patterns)) {
      if (type === 'expression') continue; // نتركه للنهاية
      
      if (pattern.test(input)) {
        return type;
      }
    }
    
    return 'expression';
  }

  /**
   * تحليل الإحداثيات الكارتيزية
   */
  parseCartesianCoordinates(input, options) {
    const match = input.match(this.patterns.cartesian);
    if (!match) {
      throw new Error('Invalid cartesian coordinates format');
    }
    
    const x = parseFloat(match[1]);
    const y = parseFloat(match[2]);
    const z = match[3] ? parseFloat(match[3]) : 0;
    
    if (isNaN(x) || isNaN(y) || isNaN(z)) {
      throw new Error('Invalid numeric values in coordinates');
    }
    
    // تحويل للوحدة الأساسية إذا لزم الأمر
    const coordinates = this.convertToBaseUnit({ x, y, z }, options.unit || this.currentUnit);
    
    // تطبيق الدقة
    coordinates.x = this.applyPrecision(coordinates.x, options.precision);
    coordinates.y = this.applyPrecision(coordinates.y, options.precision);
    coordinates.z = this.applyPrecision(coordinates.z, options.precision);
    
    return {
      type: 'coordinates',
      system: 'cartesian',
      coordinates,
      original: input,
      unit: this.currentUnit
    };
  }

  /**
   * تحليل الإحداثيات النسبية
   */
  parseRelativeCoordinates(input, options) {
    const match = input.match(this.patterns.relative);
    if (!match) {
      throw new Error('Invalid relative coordinates format');
    }
    
    const dx = parseFloat(match[1]);
    const dy = parseFloat(match[2]);
    const dz = match[3] ? parseFloat(match[3]) : 0;
    
    if (isNaN(dx) || isNaN(dy) || isNaN(dz)) {
      throw new Error('Invalid numeric values in relative coordinates');
    }
    
    // إضافة للنقطة الأخيرة
    const coordinates = {
      x: this.lastPoint.x + dx,
      y: this.lastPoint.y + dy,
      z: this.lastPoint.z + dz
    };
    
    // تحويل للوحدة الأساسية
    const convertedCoords = this.convertToBaseUnit(coordinates, options.unit || this.currentUnit);
    
    // تطبيق الدقة
    convertedCoords.x = this.applyPrecision(convertedCoords.x, options.precision);
    convertedCoords.y = this.applyPrecision(convertedCoords.y, options.precision);
    convertedCoords.z = this.applyPrecision(convertedCoords.z, options.precision);
    
    return {
      type: 'coordinates',
      system: 'cartesian',
      coordinates: convertedCoords,
      relative: true,
      offset: { x: dx, y: dy, z: dz },
      basePoint: { ...this.lastPoint },
      original: input,
      unit: this.currentUnit
    };
  }

  /**
   * تحليل الإحداثيات القطبية
   */
  parsePolarCoordinates(input, options) {
    const match = input.match(this.patterns.polar);
    if (!match) {
      throw new Error('Invalid polar coordinates format');
    }
    
    const r = parseFloat(match[1]);
    let angle = parseFloat(match[2]);
    
    if (isNaN(r) || isNaN(angle)) {
      throw new Error('Invalid numeric values in polar coordinates');
    }
    
    // تحويل الزاوية للراديان إذا كانت بالدرجات
    if (options.angleMeasure === 'degrees') {
      angle = angle * Math.PI / 180;
    }
    
    // تحويل لإحداثيات كارتيزية
    const isRelative = input.startsWith('@');
    const baseX = isRelative ? this.lastPoint.x : 0;
    const baseY = isRelative ? this.lastPoint.y : 0;
    
    const coordinates = {
      x: baseX + r * Math.cos(angle),
      y: baseY + r * Math.sin(angle),
      z: isRelative ? this.lastPoint.z : 0
    };
    
    // تحويل للوحدة الأساسية
    const convertedCoords = this.convertToBaseUnit(coordinates, options.unit || this.currentUnit);
    
    // تطبيق الدقة
    convertedCoords.x = this.applyPrecision(convertedCoords.x, options.precision);
    convertedCoords.y = this.applyPrecision(convertedCoords.y, options.precision);
    convertedCoords.z = this.applyPrecision(convertedCoords.z, options.precision);
    
    return {
      type: 'coordinates',
      system: 'polar',
      coordinates: convertedCoords,
      polar: {
        r: this.applyPrecision(r, options.precision),
        angle: this.applyPrecision(angle, options.precision),
        angleDegrees: this.applyPrecision(angle * 180 / Math.PI, options.precision)
      },
      relative: isRelative,
      basePoint: isRelative ? { ...this.lastPoint } : { x: 0, y: 0, z: 0 },
      original: input,
      unit: this.currentUnit
    };
  }

  /**
   * تحليل مسافة فقط
   */
  parseDistance(input, options) {
    const match = input.match(this.patterns.distance);
    if (!match) {
      throw new Error('Invalid distance format');
    }
    
    const distance = parseFloat(match[1]);
    
    if (isNaN(distance)) {
      throw new Error('Invalid numeric value for distance');
    }
    
    // تحويل للوحدة الأساسية
    const convertedDistance = this.convertValueToBaseUnit(distance, options.unit || this.currentUnit);
    
    return {
      type: 'distance',
      value: this.applyPrecision(convertedDistance, options.precision),
      original: input,
      unit: this.currentUnit
    };
  }

  /**
   * تحليل متغير
   */
  parseVariable(input, options) {
    if (!this.patterns.variable.test(input)) {
      throw new Error('Invalid variable name format');
    }
    
    // البحث في المتغيرات المحفوظة
    if (this.variables.has(input)) {
      const variable = this.variables.get(input);
      this.stats.variablesUsed++;
      
      return {
        type: 'variable',
        name: input,
        value: variable.value,
        description: variable.description,
        original: input
      };
    }
    
    // البحث في الثوابت
    if (this.constants.has(input)) {
      const value = this.constants.get(input);
      
      return {
        type: 'constant',
        name: input,
        value,
        original: input
      };
    }
    
    throw new Error(`Variable or constant '${input}' not found`);
  }

  /**
   * تحليل قيمة مع وحدة
   */
  parseValueWithUnit(input, options) {
    const match = input.match(this.patterns.withUnit);
    if (!match) {
      throw new Error('Invalid value with unit format');
    }
    
    const value = parseFloat(match[1]);
    const unit = match[2];
    
    if (isNaN(value)) {
      throw new Error('Invalid numeric value');
    }
    
    if (!this.supportedUnits[unit]) {
      throw new Error(`Unsupported unit: ${unit}`);
    }
    
    // تحويل للوحدة الأساسية
    const convertedValue = this.convertValueToBaseUnit(value, unit);
    
    return {
      type: 'value',
      value: this.applyPrecision(convertedValue, options.precision),
      originalValue: value,
      originalUnit: unit,
      unit: this.currentUnit,
      original: input
    };
  }

  /**
   * تحليل تعبير رياضي
   */
  parseExpression(input, options) {
    try {
      const result = this.evaluateExpression(input);
      this.stats.calculationsPerformed++;
      
      return {
        type: 'expression',
        value: this.applyPrecision(result, options.precision),
        expression: input,
        original: input
      };
    } catch (error) {
      throw new Error(`Expression evaluation failed: ${error.message}`);
    }
  }

  /**
   * تحليل تعيين متغير
   */
  parseAssignment(varName, expression, options) {
    if (!this.patterns.variable.test(varName)) {
      throw new Error('Invalid variable name');
    }
    
    const value = this.evaluateExpression(expression);
    this.setVariable(varName, value, `Assigned from: ${expression}`);
    
    return {
      type: 'assignment',
      variable: varName,
      value: this.applyPrecision(value, options.precision),
      expression,
      original: `${varName}=${expression}`
    };
  }

  /**
   * تقييم تعبير رياضي آمن
   */
  evaluateExpression(expression, additionalVars = {}) {
    const context = {
      ...Object.fromEntries(this.constants),
      ...Object.fromEntries(
        Array.from(this.variables.entries()).map(([k, v]) => [k, v.value])
      ),
      ...additionalVars
    };
    
    for (const [name, func] of this.functions) {
      context[name] = func;
    }
    
    const cleanExpression = this.sanitizeExpression(expression);
    
    try {
      const keys = Object.keys(context);
      const values = Object.values(context);
      
      // استخدام sandbox آمن
      const sandboxedEval = new Function(
        'sandbox',
        `with (sandbox) {
          return (function() {
            'use strict';
            try {
              return ${cleanExpression};
            } catch (e) {
              throw new Error('Expression evaluation failed: ' + e.message);
            }
          })();
        }`
      );
      
      const result = sandboxedEval(Object.freeze(context));
      
      if (typeof result !== 'number' || isNaN(result) || !isFinite(result)) {
        throw new Error('Expression did not evaluate to a valid finite number');
      }
      
      return result;
    } catch (error) {
      throw new Error(`Invalid expression: ${error.message}`);
    }
  }

  /**
   * تنظيف التعبير من الرموز الخطيرة
   */
  sanitizeExpression(expression) {
    // إزالة الأحرف الخطيرة
    const dangerous = /[;{}[\]`]/g;
    const cleaned = expression.replace(dangerous, '');
    
    // فحص الكلمات المحظورة
    const forbidden = /\b(eval|function|Function|constructor|prototype|__proto__|import|require|process|global|window|document)\b/gi;
    if (forbidden.test(cleaned)) {
      throw new Error('Expression contains forbidden keywords');
    }
    
    return cleaned;
  }

  /**
   * ضبط متغير
   */
  setVariable(name, value, description = '') {
    if (!this.patterns.variable.test(name)) {
      throw new Error('Invalid variable name format');
    }
    
    if (typeof value !== 'number' || isNaN(value)) {
      throw new Error('Variable value must be a valid number');
    }
    
    this.variables.set(name, {
      value,
      description,
      createdAt: this.variables.has(name) ? this.variables.get(name).createdAt : Date.now(),
      modifiedAt: Date.now()
    });
  }

  /**
   * تحديث إعدادات التحليل
   */
  updateParseSettings(newSettings) {
    const allowedSettings = ['angleMeasure', 'coordinateSystem', 'precision', 'strictMode'];
    
    for (const [key, value] of Object.entries(newSettings)) {
      if (allowedSettings.includes(key)) {
        if (key === 'angleMeasure' && !['degrees', 'radians'].includes(value)) {
          throw new Error('angleMeasure must be "degrees" or "radians"');
        }
        
        if (key === 'precision' && (typeof value !== 'number' || value < 0 || value > 15)) {
          throw new Error('precision must be a number between 0 and 15');
        }
        
        this.parseSettings[key] = value;
      }
    }
  }

  /**
   * الحصول على اقتراحات للإكمال التلقائي
   */
  getAutocompleteSuggestions(partial, context = {}) {
    const suggestions = [];
    
    // اقتراحات المتغيرات
    for (const varName of this.variables.keys()) {
      if (varName.toLowerCase().startsWith(partial.toLowerCase())) {
        suggestions.push({
          type: 'variable',
          text: varName,
          description: this.variables.get(varName).description,
          value: this.variables.get(varName).value
        });
      }
    }
    
    // اقتراحات الثوابت
    for (const constName of this.constants.keys()) {
      if (constName.toLowerCase().startsWith(partial.toLowerCase())) {
        suggestions.push({
          type: 'constant',
          text: constName,
          description: `Mathematical constant (${this.constants.get(constName)})`,
          value: this.constants.get(constName)
        });
      }
    }
    
    // اقتراحات الدوال
    for (const funcName of this.functions.keys()) {
      if (funcName.toLowerCase().startsWith(partial.toLowerCase())) {
        suggestions.push({
          type: 'function',
          text: `${funcName}()`,
          description: `Mathematical function`,
          insertText: `${funcName}(`
        });
      }
    }
    
    // اقتراحات الوحدات
    for (const unit of Object.keys(this.supportedUnits)) {
      if (unit.toLowerCase().startsWith(partial.toLowerCase())) {
        suggestions.push({
          type: 'unit',
          text: unit,
          description: `Unit of measurement`,
          insertText: unit
        });
      }
    }
    
    return suggestions.slice(0, 10); // أقصى 10 اقتراحات
  }

  /**
   * الحصول على اقتراحات لإصلاح الأخطاء
   */
  getSuggestions(input) {
    const sanitizedInput = this.sanitizeForDisplay(input);
    const suggestions = [];
    
    // اقتراحات للأخطاء الشائعة
    if (sanitizedInput.includes(',') && !this.patterns.cartesian.test(input)) {
      suggestions.push('Check coordinate format: "x,y" or "x,y,z"');
    }
    
    if (sanitizedInput.includes('<') && !this.patterns.polar.test(input)) {
      suggestions.push('Check polar format: "distance<angle" or "@distance<angle"');
    }
    
    if (sanitizedInput.includes('=') && !this.patterns.assignment.test(input)) {
      suggestions.push('Check assignment format: "variable=expression"');
    }
    
    // اقتراحات الأسماء المشابهة
    const words = input.split(/[^\w]/);
    for (const word of words) {
      if (word.length > 2) {
        const similar = this.findSimilarNames(word);
        if (similar.length > 0) {
          suggestions.push(`Did you mean: ${similar.join(', ')}?`);
        }
      }
    }
    
    return suggestions;
  }

  /**
   * البحث عن أسماء مشابهة
   */
  findSimilarNames(word) {
    const allNames = [
      ...this.variables.keys(),
      ...this.constants.keys(),
      ...this.functions.keys()
    ];
    
    const similar = [];
    const wordLower = word.toLowerCase();
    
    for (const name of allNames) {
      const nameLower = name.toLowerCase();
      
      // تطابق جزئي
      if (nameLower.includes(wordLower) || wordLower.includes(nameLower)) {
        similar.push(name);
      }
      
      // مسافة Levenshtein بسيطة
      if (this.levenshteinDistance(wordLower, nameLower) <= 2) {
        similar.push(name);
      }
    }
    
    return similar.slice(0, 3);
  }

  /**
   * حساب مسافة Levenshtein
   */
  levenshteinDistance(a, b) {
    const matrix = [];
    
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i];
    }
    
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j;
    }
    
    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b.charAt(i - 1) === a.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }
    
    return matrix[b.length][a.length];
  }

  /**
   * إضافة للتاريخ
   */
  addToHistory(input, result) {
    this.inputHistory.push({
      input,
      result,
      timestamp: Date.now()
    });
    
    // الحفاظ على الحد الأقصى للتاريخ
    if (this.inputHistory.length > this.maxHistorySize) {
      this.inputHistory.shift();
    }
  }

  /**
   * تحويل قيمة للوحدة الأساسية
   */
  convertValueToBaseUnit(value, fromUnit) {
    const conversion = this.supportedUnits[fromUnit];
    if (!conversion) {
      throw new Error(`Unsupported unit: ${fromUnit}`);
    }
    
    return value * conversion;
  }

  /**
   * تحويل إحداثيات للوحدة الأساسية
   */
  convertToBaseUnit(coordinates, fromUnit) {
    const conversion = this.supportedUnits[fromUnit];
    if (!conversion) {
      return coordinates;
    }
    
    return {
      x: coordinates.x * conversion,
      y: coordinates.y * conversion,
      z: coordinates.z * conversion
    };
  }

  /**
   * تطبيق الدقة
   */
  applyPrecision(value, precision = this.parseSettings.precision) {
    return Math.round(value * Math.pow(10, precision)) / Math.pow(10, precision);
  }

  // دورة الحياة
  async start() {
    console.log('Input Handler module started');
    console.log(`Current unit: ${this.currentUnit}`);
    console.log(`Variables: ${this.variables.size}, Constants: ${this.constants.size}`);
  }

  async stop() {
    console.log('Input Handler module stopped');
  }

  async healthCheck() {
    return {
      healthy: true,
      currentUnit: this.currentUnit,
      variablesCount: this.variables.size,
      stats: this.stats
    };
  }

  async cleanup() {
    this.variables.clear();
    this.inputHistory.length = 0;
    this.msg.off('input.*');
  }
}
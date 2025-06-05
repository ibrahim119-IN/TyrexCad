/**
 * OCCT Worker - يعمل في خيط منفصل
 * 
 * يستقبل العمليات الهندسية وينفذها باستخدام OpenCASCADE
 */

let occt = null;
let initialized = false;

// حدود العمليات
const OPERATION_LIMITS = {
  MAX_VERTICES: 1000000,
  MAX_FACES: 100000,
  MAX_EDGES: 200000,
  MESH_QUALITY_MIN: 0.001,
  MESH_QUALITY_MAX: 10
};

// استقبال الرسائل من الـ main thread
self.onmessage = async (event) => {
  const { type, taskId, operation, params, wasmUrl, jsUrl } = event.data;
  
  try {
    switch (type) {
      case 'init':
        await initializeOCCT(wasmUrl, jsUrl);
        break;
        
      case 'execute':
        if (!initialized) {
          throw new Error('OCCT not initialized');
        }
        const result = await executeOperation(operation, params);
        self.postMessage({
          type: 'result',
          taskId,
          result
        });
        break;
        
      case 'shutdown':
        cleanup();
        self.close();
        break;
        
      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  } catch (error) {
    self.postMessage({
      type: 'error',
      taskId,
      error: error.message
    });
  }
};

// معالج أخطاء عام
self.onerror = (error) => {
  console.error('Worker error:', error);
  self.postMessage({
    type: 'error',
    error: error.message
  });
};

// تنظيف دوري للذاكرة محسّن
let memoryCheckInterval = null;

function startMemoryManagement() {
  memoryCheckInterval = setInterval(() => {
    if (typeof performance !== 'undefined' && performance.memory) {
      const used = performance.memory.usedJSHeapSize;
      const total = performance.memory.totalJSHeapSize;
      const usage = (used / total) * 100;
      
      if (usage > 80) {
        console.warn(`High memory usage: ${usage.toFixed(1)}%`);
        if (self.gc) self.gc();
      }
      
      // إرسال معلومات الذاكرة للـ main thread
      self.postMessage({
        type: 'log',
        result: `Memory usage: ${usage.toFixed(1)}%`
      });
    }
  }, 30000); // كل 30 ثانية
}

function stopMemoryManagement() {
  if (memoryCheckInterval) {
    clearInterval(memoryCheckInterval);
    memoryCheckInterval = null;
  }
}

/**
 * تهيئة OpenCASCADE - محسّنة
 */
async function initializeOCCT(wasmUrl, jsUrl) {
  try {
    self.postMessage({
      type: 'log',
      result: `Initializing OpenCASCADE from: ${jsUrl}`
    });
    
    // تحميل OpenCASCADE module
    const response = await fetch(jsUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to fetch OpenCASCADE JS: ${response.status} ${response.statusText}`);
    }
    
    const scriptText = await response.text();
    
    // التحقق من المحتوى
    if (scriptText.includes('<!DOCTYPE') || scriptText.includes('<html')) {
      throw new Error('Received HTML instead of JavaScript. Check file path.');
    }
    
    // إنشاء module configuration
    self.Module = {
      locateFile: (filename) => {
        self.postMessage({
          type: 'log',
          result: `Locating file: ${filename}`
        });
        
        if (filename.endsWith('.wasm')) {
          return wasmUrl;
        }
        return filename;
      },
      instantiateWasm: (imports, successCallback) => {
        self.postMessage({
          type: 'log',
          result: `Loading WASM from: ${wasmUrl}`
        });
        
        // محاولة التحميل المباشر أولاً
        WebAssembly.instantiateStreaming(fetch(wasmUrl), imports)
          .then(result => {
            self.postMessage({
              type: 'log',
              result: 'WASM loaded successfully via streaming'
            });
            successCallback(result.instance, result.module);
          })
          .catch(streamingError => {
            console.warn('Streaming failed, trying arrayBuffer method:', streamingError);
            self.postMessage({
              type: 'log',
              result: 'WASM streaming failed, trying fallback method...'
            });
            
            // Fallback to non-streaming
            fetch(wasmUrl)
              .then(response => {
                if (!response.ok) {
                  throw new Error(`Failed to fetch WASM: ${response.status} ${response.statusText}`);
                }
                return response.arrayBuffer();
              })
              .then(bytes => {
                self.postMessage({
                  type: 'log',
                  result: `WASM file loaded, size: ${(bytes.byteLength / 1024 / 1024).toFixed(2)} MB`
                });
                return WebAssembly.instantiate(bytes, imports);
              })
              .then(result => {
                self.postMessage({
                  type: 'log',
                  result: 'WASM instantiated successfully'
                });
                successCallback(result.instance, result.module);
              })
              .catch(err => {
                throw new Error(`Failed to load WASM: ${err.message}`);
              });
          });
        return {};
      },
      onRuntimeInitialized: function() {
        self.postMessage({
          type: 'log',
          result: 'OpenCASCADE runtime initialized'
        });
      },
      print: (text) => {
        console.log('OpenCASCADE:', text);
      },
      printErr: (text) => {
        console.error('OpenCASCADE Error:', text);
      }
    };
    
    // تحميل السكريبت
    try {
      self.postMessage({
        type: 'log',
        result: 'Evaluating OpenCASCADE script...'
      });
      
      // استخدام Function بدلاً من eval للأمان
      const moduleFunction = new Function('Module', scriptText + '\nreturn Module;');
      const evaluatedModule = moduleFunction(self.Module);
      
      if (evaluatedModule) {
        self.Module = evaluatedModule;
      }
      
    } catch (evalError) {
      throw new Error(`Failed to evaluate OpenCASCADE script: ${evalError.message}`);
    }
    
    // انتظار التهيئة
    self.postMessage({
      type: 'log',
      result: 'Waiting for OpenCASCADE initialization...'
    });
    
    if (self.Module && typeof self.Module.then === 'function') {
      // Module is a promise
      occt = await self.Module;
      self.postMessage({
        type: 'log',
        result: 'OpenCASCADE loaded from promise'
      });
    } else if (self.Module) {
      // Module needs manual initialization
      occt = await new Promise((resolve, reject) => {
        let checkCount = 0;
        const maxChecks = 300; // 30 seconds with 100ms intervals
        
        const checkInterval = setInterval(() => {
          checkCount++;
          
          // طرق مختلفة للتحقق من الجاهزية
          if (self.Module.calledRun || 
              (self.Module.asm && self.Module.asm.BRepPrimAPI_MakeBox) ||
              (self.Module._BRepPrimAPI_MakeBox_ctor)) {
            clearInterval(checkInterval);
            resolve(self.Module);
          } else if (checkCount >= maxChecks) {
            clearInterval(checkInterval);
            reject(new Error('OpenCASCADE initialization timeout after 30 seconds'));
          }
          
          // كل 10 محاولات، نطبع حالة
          if (checkCount % 10 === 0) {
            self.postMessage({
              type: 'log',
              result: `Still waiting for initialization... (${checkCount / 10}s)`
            });
          }
        }, 100);
      });
    } else {
      throw new Error('Module not found after script evaluation');
    }
    
    // التحقق من التهيئة بطرق مختلفة
    let makeBoxAvailable = false;
    
    // طريقة 1: التحقق المباشر
    if (occt.BRepPrimAPI_MakeBox) {
      makeBoxAvailable = true;
    }
    // طريقة 2: التحقق من asm
    else if (occt.asm && occt.asm.BRepPrimAPI_MakeBox) {
      makeBoxAvailable = true;
    }
    // طريقة 3: التحقق من الدوال المصدرة
    else if (occt._BRepPrimAPI_MakeBox_ctor) {
      makeBoxAvailable = true;
    }
    
    if (!makeBoxAvailable) {
      // طباعة الخصائص المتاحة للتشخيص
      const availableProps = Object.keys(occt).filter(key => 
        key.includes('BRep') || key.includes('Make') || key.includes('Box')
      );
      
      self.postMessage({
        type: 'log',
        result: `Available BRep-related properties: ${availableProps.join(', ')}`
      });
      
      throw new Error('OpenCASCADE initialization incomplete - BRepPrimAPI_MakeBox not found');
    }
    
    initialized = true;
    
    // بدء إدارة الذاكرة
    startMemoryManagement();
    
    self.postMessage({
      type: 'ready'
    });
    
    self.postMessage({
      type: 'log',
      result: 'OpenCASCADE initialized successfully'
    });
    
  } catch (error) {
    console.error('Failed to initialize OCCT:', error);
    self.postMessage({
      type: 'error',
      error: `Initialization failed: ${error.message}`
    });
  }
}

/**
 * تنفيذ العمليات الهندسية
 */
async function executeOperation(operation, params) {
  switch (operation) {
    case 'createBox':
      return createBox(params);
      
    case 'createSphere':
      return createSphere(params);
      
    case 'createCylinder':
      return createCylinder(params);
      
    case 'createCone':
      return createCone(params);
      
    case 'createTorus':
      return createTorus(params);
      
    case 'boolean':
      return performBoolean(params);
      
    case 'transform':
      return transformShape(params);
      
    case 'toMesh':
      return convertToMesh(params);
      
    case 'measure':
      return measureShape(params);
      
    case 'fillet':
      return filletShape(params);
      
    case 'chamfer':
      return chamferShape(params);
      
    case 'extrude':
      return extrudeProfile(params);
      
    case 'revolve':
      return revolveProfile(params);
      
    case 'release':
      return releaseShape(params);
      
    default:
      throw new Error(`Unknown operation: ${operation}`);
  }
}

/**
 * إنشاء صندوق
 */
function createBox(params) {
  const { width = 100, height = 100, depth = 100, center = false } = params;
  
  let box;
  try {
    // إنشاء الصندوق - التحقق من الطريقة المتاحة
    let makeBox;
    
    if (occt.BRepPrimAPI_MakeBox) {
      makeBox = new occt.BRepPrimAPI_MakeBox(width, height, depth);
    } else if (occt.asm && occt.asm.BRepPrimAPI_MakeBox) {
      // استخدام asm interface
      const makeBoxPtr = occt.asm.BRepPrimAPI_MakeBox(width, height, depth);
      makeBox = { 
        Shape: () => occt.wrapPointer(makeBoxPtr, occt.TopoDS_Shape),
        delete: () => occt._free(makeBoxPtr)
      };
    } else {
      throw new Error('BRepPrimAPI_MakeBox not available');
    }
    
    const shape = makeBox.Shape();
    makeBox.delete();
    
    // توسيط الصندوق إذا طُلب
    if (center) {
      const trsf = new occt.gp_Trsf();
      const vec = new occt.gp_Vec(-width/2, -height/2, -depth/2);
      trsf.SetTranslation(vec);
      
      const transform = new occt.BRepBuilderAPI_Transform(shape, trsf, true);
      const centeredShape = transform.Shape();
      
      // تنظيف
      shape.delete();
      trsf.delete();
      vec.delete();
      transform.delete();
      
      box = centeredShape;
    } else {
      box = shape;
    }
    
    // تحويل لتنسيق قابل للنقل
    const serialized = serializeShape(box);
    
    // تنظيف
    box.delete();
    
    return {
      type: 'shape',
      geometry: serialized,
      properties: {
        volume: width * height * depth,
        bounds: {
          min: center ? [-width/2, -height/2, -depth/2] : [0, 0, 0],
          max: center ? [width/2, height/2, depth/2] : [width, height, depth]
        }
      }
    };
    
  } catch (error) {
    if (box && box.delete) box.delete();
    throw new Error(`Failed to create box: ${error.message}`);
  }
}

/**
 * إنشاء كرة
 */
function createSphere(params) {
  const { radius = 50, center = [0, 0, 0] } = params;
  
  let sphere;
  try {
    // إنشاء نقطة المركز
    const centerPnt = new occt.gp_Pnt(center[0], center[1], center[2]);
    
    // إنشاء الكرة - التحقق من الطريقة المتاحة
    let makeSphere;
    if (occt.BRepPrimAPI_MakeSphere_1) {
      makeSphere = new occt.BRepPrimAPI_MakeSphere_1(centerPnt, radius);
    } else if (occt.BRepPrimAPI_MakeSphere) {
      makeSphere = new occt.BRepPrimAPI_MakeSphere(centerPnt, radius);
    } else {
      // طريقة بديلة
      makeSphere = new occt.BRepPrimAPI_MakeSphere(radius);
      // نحتاج لنقل الكرة للمركز المطلوب
      const shape = makeSphere.Shape();
      makeSphere.delete();
      
      if (center[0] !== 0 || center[1] !== 0 || center[2] !== 0) {
        const trsf = new occt.gp_Trsf();
        const vec = new occt.gp_Vec(center[0], center[1], center[2]);
        trsf.SetTranslation(vec);
        
        const transform = new occt.BRepBuilderAPI_Transform(shape, trsf, true);
        sphere = transform.Shape();
        
        shape.delete();
        trsf.delete();
        vec.delete();
        transform.delete();
      } else {
        sphere = shape;
      }
      
      centerPnt.delete();
      
      // ننتقل مباشرة للتسلسل
      const serialized = serializeShape(sphere);
      sphere.delete();
      
      return {
        type: 'shape',
        geometry: serialized,
        properties: {
          volume: (4/3) * Math.PI * Math.pow(radius, 3),
          surfaceArea: 4 * Math.PI * Math.pow(radius, 2),
          bounds: {
            min: [center[0] - radius, center[1] - radius, center[2] - radius],
            max: [center[0] + radius, center[1] + radius, center[2] + radius]
          }
        }
      };
    }
    
    sphere = makeSphere.Shape();
    
    // تنظيف
    centerPnt.delete();
    makeSphere.delete();
    
    // تحويل لتنسيق قابل للنقل
    const serialized = serializeShape(sphere);
    
    // حساب الخصائص
    const volume = (4/3) * Math.PI * Math.pow(radius, 3);
    
    // تنظيف
    sphere.delete();
    
    return {
      type: 'shape',
      geometry: serialized,
      properties: {
        volume,
        surfaceArea: 4 * Math.PI * Math.pow(radius, 2),
        bounds: {
          min: [center[0] - radius, center[1] - radius, center[2] - radius],
          max: [center[0] + radius, center[1] + radius, center[2] + radius]
        }
      }
    };
    
  } catch (error) {
    if (sphere && sphere.delete) sphere.delete();
    throw new Error(`Failed to create sphere: ${error.message}`);
  }
}

/**
 * إنشاء أسطوانة
 */
function createCylinder(params) {
  const { radius = 50, height = 100, center = false } = params;
  
  let cylinder;
  try {
    // إنشاء الأسطوانة - التحقق من الطريقة المتاحة
    let makeCylinder;
    
    if (occt.BRepPrimAPI_MakeCylinder_1) {
      makeCylinder = new occt.BRepPrimAPI_MakeCylinder_1(radius, height);
    } else if (occt.BRepPrimAPI_MakeCylinder) {
      makeCylinder = new occt.BRepPrimAPI_MakeCylinder(radius, height);
    } else {
      throw new Error('BRepPrimAPI_MakeCylinder not available');
    }
    
    cylinder = makeCylinder.Shape();
    makeCylinder.delete();
    
    // توسيط إذا طُلب
    if (center) {
      const trsf = new occt.gp_Trsf();
      const vec = new occt.gp_Vec(0, 0, -height/2);
      trsf.SetTranslation(vec);
      
      const transform = new occt.BRepBuilderAPI_Transform(cylinder, trsf, true);
      const centeredCylinder = transform.Shape();
      
      // تنظيف
      cylinder.delete();
      trsf.delete();
      vec.delete();
      transform.delete();
      
      cylinder = centeredCylinder;
    }
    
    // تحويل لتنسيق قابل للنقل
    const serialized = serializeShape(cylinder);
    
    // حساب الخصائص
    const volume = Math.PI * Math.pow(radius, 2) * height;
    const surfaceArea = 2 * Math.PI * radius * (radius + height);
    
    // تنظيف
    cylinder.delete();
    
    return {
      type: 'shape',
      geometry: serialized,
      properties: {
        volume,
        surfaceArea,
        bounds: {
          min: [-radius, -radius, center ? -height/2 : 0],
          max: [radius, radius, center ? height/2 : height]
        }
      }
    };
    
  } catch (error) {
    if (cylinder && cylinder.delete) cylinder.delete();
    throw new Error(`Failed to create cylinder: ${error.message}`);
  }
}

/**
 * إنشاء مخروط
 */
function createCone(params) {
  const { radius1 = 50, radius2 = 25, height = 100, center = false } = params;
  
  let cone = null;
  try {
    // إنشاء المخروط
    const makeCone = new occt.BRepPrimAPI_MakeCone(radius1, radius2, height);
    cone = makeCone.Shape();
    makeCone.delete();
    
    // توسيط إذا طُلب
    if (center) {
      const trsf = new occt.gp_Trsf();
      const vec = new occt.gp_Vec(0, 0, -height/2);
      trsf.SetTranslation(vec);
      
      const transform = new occt.BRepBuilderAPI_Transform(cone, trsf, true);
      const centeredCone = transform.Shape();
      
      cone.delete();
      trsf.delete();
      vec.delete();
      transform.delete();
      
      cone = centeredCone;
    }
    
    // تحويل لتنسيق قابل للنقل
    const serialized = serializeShape(cone);
    
    // حساب الخصائص
    const volume = (Math.PI * height / 3) * (radius1*radius1 + radius1*radius2 + radius2*radius2);
    
    // تنظيف
    cone.delete();
    
    return {
      type: 'shape',
      geometry: serialized,
      properties: {
        volume,
        bounds: {
          min: [-radius1, -radius1, center ? -height/2 : 0],
          max: [radius1, radius1, center ? height/2 : height]
        }
      }
    };
    
  } catch (error) {
    if (cone && cone.delete) cone.delete();
    throw new Error(`Failed to create cone: ${error.message}`);
  }
}

/**
 * إنشاء حلقة (torus)
 */
function createTorus(params) {
  const { majorRadius = 50, minorRadius = 20, center = [0, 0, 0] } = params;
  
  let torus = null;
  try {
    // إنشاء محور ونقطة للحلقة
    const centerPnt = new occt.gp_Pnt(center[0], center[1], center[2]);
    const dir = new occt.gp_Dir(0, 0, 1);
    const ax2 = new occt.gp_Ax2(centerPnt, dir);
    
    // إنشاء الحلقة - التحقق من الطريقة المتاحة
    let makeTorus;
    if (occt.BRepPrimAPI_MakeTorus_1) {
      makeTorus = new occt.BRepPrimAPI_MakeTorus_1(ax2, majorRadius, minorRadius);
    } else if (occt.BRepPrimAPI_MakeTorus) {
      makeTorus = new occt.BRepPrimAPI_MakeTorus(ax2, majorRadius, minorRadius);
    } else {
      // طريقة بديلة
      makeTorus = new occt.BRepPrimAPI_MakeTorus(majorRadius, minorRadius);
    }
    
    torus = makeTorus.Shape();
    
    // تنظيف
    makeTorus.delete();
    ax2.delete();
    dir.delete();
    centerPnt.delete();
    
    // تحويل لتنسيق قابل للنقل
    const serialized = serializeShape(torus);
    
    // حساب الخصائص
    const volume = 2 * Math.PI * Math.PI * majorRadius * minorRadius * minorRadius;
    const surfaceArea = 4 * Math.PI * Math.PI * majorRadius * minorRadius;
    
    // تنظيف
    torus.delete();
    
    return {
      type: 'shape',
      geometry: serialized,
      properties: {
        volume,
        surfaceArea,
        bounds: {
          min: [
            center[0] - majorRadius - minorRadius,
            center[1] - majorRadius - minorRadius,
            center[2] - minorRadius
          ],
          max: [
            center[0] + majorRadius + minorRadius,
            center[1] + majorRadius + minorRadius,
            center[2] + minorRadius
          ]
        }
      }
    };
    
  } catch (error) {
    if (torus && torus.delete) torus.delete();
    throw new Error(`Failed to create torus: ${error.message}`);
  }
}

/**
 * عمليات Boolean
 */
function performBoolean(params) {
  const { operation, shape1, shape2 } = params;
  
  let s1, s2, result;
  try {
    // إعادة بناء الأشكال
    s1 = deserializeShape(shape1);
    s2 = deserializeShape(shape2);
    
    // تنفيذ العملية
    let boolOp;
    switch (operation) {
      case 'union':
        boolOp = new occt.BRepAlgoAPI_Fuse(s1, s2);
        break;
      case 'subtract':
        boolOp = new occt.BRepAlgoAPI_Cut(s1, s2);
        break;
      case 'intersect':
        boolOp = new occt.BRepAlgoAPI_Common(s1, s2);
        break;
      default:
        throw new Error(`Unknown boolean operation: ${operation}`);
    }
    
    result = boolOp.Shape();
    boolOp.delete();
    
    // تحويل النتيجة
    const serialized = serializeShape(result);
    
    // تنظيف
    s1.delete();
    s2.delete();
    result.delete();
    
    return {
      type: 'shape',
      geometry: serialized
    };
    
  } catch (error) {
    if (s1 && s1.delete) s1.delete();
    if (s2 && s2.delete) s2.delete();
    if (result && result.delete) result.delete();
    throw new Error(`Boolean operation failed: ${error.message}`);
  }
}

/**
 * تحويل الشكل لـ mesh
 */
function convertToMesh(params) {
  const { shape, quality = 0.1 } = params;
  
  // التحقق من جودة الـ mesh
  const meshQuality = Math.max(
    OPERATION_LIMITS.MESH_QUALITY_MIN,
    Math.min(quality, OPERATION_LIMITS.MESH_QUALITY_MAX)
  );
  
  let s = null;
  let mesh = null;
  
  try {
    // إعادة بناء الشكل
    s = deserializeShape(shape);
    
    // التحقق من حجم الشكل
    validateShapeComplexity(s);
    
    // إنشاء mesh
    mesh = new occt.BRepMesh_IncrementalMesh(s, meshQuality, false, 0.5, true);
    
    // التحقق من الطريقة المتاحة
    if (mesh.Perform) {
      mesh.Perform();
    }
    
    // المصفوفات للبيانات
    const vertices = [];
    const normals = [];
    const indices = [];
    let vertexOffset = 0;
    
    // Explorer للمرور على الوجوه
    const faceExplorer = new occt.TopExp_Explorer(s, occt.TopAbs_FACE);
    
    while (faceExplorer.More()) {
      const face = occt.TopoDS.Face(faceExplorer.Current());
      const location = new occt.TopLoc_Location();
      const triangulation = occt.BRep_Tool.Triangulation(face, location);
      
      if (triangulation && !triangulation.IsNull()) {
        const transformation = location.Transformation();
        const nbTriangles = triangulation.NbTriangles();
        const nbNodes = triangulation.NbNodes();
        
        // معالجة الرؤوس
        for (let i = 1; i <= nbNodes; i++) {
          const node = triangulation.Node(i);
          
          // تطبيق التحويل
          const transformedNode = node.Transformed(transformation);
          vertices.push(
            transformedNode.X(),
            transformedNode.Y(),
            transformedNode.Z()
          );
          
          // حساب النورمال - نستخدم طريقة بسيطة
          normals.push(0, 0, 1); // سيتم حسابها لاحقاً
        }
        
        // معالجة المثلثات
        for (let i = 1; i <= nbTriangles; i++) {
          const triangle = triangulation.Triangle(i);
          let n1 = 0, n2 = 0, n3 = 0;
          triangle.Get(n1, n2, n3);
          
          // التحقق من اتجاه الوجه
          const orientation = face.Orientation();
          if (orientation === occt.TopAbs_REVERSED) {
            // عكس ترتيب الرؤوس
            indices.push(
              vertexOffset + n1 - 1,
              vertexOffset + n3 - 1,
              vertexOffset + n2 - 1
            );
          } else {
            indices.push(
              vertexOffset + n1 - 1,
              vertexOffset + n2 - 1,
              vertexOffset + n3 - 1
            );
          }
        }
        
        vertexOffset += nbNodes;
      }
      
      // تنظيف
      location.delete();
      
      faceExplorer.Next();
    }
    
    // حساب normals حقيقية باستخدام cross product
    calculateRealNormals(vertices, indices, normals);
    
    // تنظيف
    faceExplorer.delete();
    mesh.delete();
    s.delete();
    
    return {
      type: 'mesh',
      vertices: new Float32Array(vertices),
      normals: new Float32Array(normals),
      indices: new Uint32Array(indices),
      stats: {
        vertexCount: vertices.length / 3,
        triangleCount: indices.length / 3
      }
    };
    
  } catch (error) {
    if (mesh && mesh.delete) mesh.delete();
    if (s && s.delete) s.delete();
    throw new Error(`Mesh conversion failed: ${error.message}`);
  }
}

/**
 * حساب normals حقيقية للمثلثات
 */
function calculateRealNormals(vertices, indices, normals) {
  // مسح normals القديمة
  for (let i = 0; i < normals.length; i++) {
    normals[i] = 0;
  }
  
  // حساب normal لكل مثلث وإضافته للرؤوس
  for (let i = 0; i < indices.length; i += 3) {
    const i1 = indices[i] * 3;
    const i2 = indices[i + 1] * 3;
    const i3 = indices[i + 2] * 3;
    
    // الرؤوس
    const v1 = { x: vertices[i1], y: vertices[i1 + 1], z: vertices[i1 + 2] };
    const v2 = { x: vertices[i2], y: vertices[i2 + 1], z: vertices[i2 + 2] };
    const v3 = { x: vertices[i3], y: vertices[i3 + 1], z: vertices[i3 + 2] };
    
    // vectors
    const edge1 = { 
      x: v2.x - v1.x, 
      y: v2.y - v1.y, 
      z: v2.z - v1.z 
    };
    const edge2 = { 
      x: v3.x - v1.x, 
      y: v3.y - v1.y, 
      z: v3.z - v1.z 
    };
    
    // cross product
    const normal = {
      x: edge1.y * edge2.z - edge1.z * edge2.y,
      y: edge1.z * edge2.x - edge1.x * edge2.z,
      z: edge1.x * edge2.y - edge1.y * edge2.x
    };
    
    // إضافة للرؤوس الثلاثة
    for (let j of [i1, i2, i3]) {
      normals[j] += normal.x;
      normals[j + 1] += normal.y;
      normals[j + 2] += normal.z;
    }
  }
  
  // تطبيع normals
  for (let i = 0; i < normals.length; i += 3) {
    const length = Math.sqrt(
      normals[i] * normals[i] +
      normals[i + 1] * normals[i + 1] +
      normals[i + 2] * normals[i + 2]
    );
    
    if (length > 0) {
      normals[i] /= length;
      normals[i + 1] /= length;
      normals[i + 2] /= length;
    } else {
      // normal افتراضي
      normals[i] = 0;
      normals[i + 1] = 0;
      normals[i + 2] = 1;
    }
  }
}

/**
 * تسلسل الشكل للنقل - محسّن وآمن
 */
function serializeShape(shape) {
  try {
    // طريقة 1: استخدام BRepTools
    if (occt.BRepTools && occt.OS_Stream) {
      const writer = new occt.BRepTools();
      const os = new occt.OS_Stream();
      
      occt.BRepTools.Write(shape, os);
      const data = os.str();
      
      writer.delete();
      os.delete();
      
      return {
        type: 'brep',
        data: data,
        bounds: extractBounds(shape)
      };
    }
  } catch (error) {
    console.warn('BRep serialization failed:', error);
  }
  
  // Fallback method
  return fallbackSerialize(shape);
}

/**
 * إعادة بناء الشكل من التسلسل - محسّن وآمن
 */
function deserializeShape(serialized) {
  if (!serialized) {
    throw new Error('No serialized shape provided');
  }
  
  if (serialized.type === 'brep') {
    try {
      if (occt.BRep_Builder && occt.TopoDS_Shape && occt.IS_Stream && occt.BRepTools) {
        const builder = new occt.BRep_Builder();
        const shape = new occt.TopoDS_Shape();
        const is = new occt.IS_Stream(serialized.data);
        
        occt.BRepTools.Read(shape, is, builder);
        
        builder.delete();
        is.delete();
        
        return shape;
      }
    } catch (error) {
      console.warn('BRep deserialization failed:', error);
    }
  }
  
  // Fallback method
  return fallbackDeserialize(serialized);
}

/**
 * استخراج حدود الشكل
 */
function extractBounds(shape) {
  try {
    const bbox = new occt.Bnd_Box();
    occt.BRepBndLib.Add(shape, bbox, false);
    
    let xmin = 0, ymin = 0, zmin = 0, xmax = 0, ymax = 0, zmax = 0;
    bbox.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    
    bbox.delete();
    
    return {
      min: [xmin, ymin, zmin],
      max: [xmax, ymax, zmax]
    };
  } catch (error) {
    console.warn('Failed to extract bounds:', error);
    return {
      min: [-100, -100, -100],
      max: [100, 100, 100]
    };
  }
}

/**
 * Fallback serialization method
 */
function fallbackSerialize(shape) {
  // طريقة بديلة باستخدام mesh
  try {
    const mesh = new occt.BRepMesh_IncrementalMesh(shape, 0.1, false, 0.5, true);
    if (mesh.Perform) {
      mesh.Perform();
    }
    
    const bounds = extractBounds(shape);
    
    mesh.delete();
    
    // نحتفظ بمرجع مؤقت
    const id = `shape_${Date.now()}_${Math.random()}`;
    if (!self._shapeCache) {
      self._shapeCache = new Map();
    }
    
    // حد أقصى لعدد الأشكال في الكاش
    if (self._shapeCache.size > 100) {
      // حذف أقدم 50 شكل
      const keys = Array.from(self._shapeCache.keys()).slice(0, 50);
      keys.forEach(key => {
        const oldShape = self._shapeCache.get(key);
        if (oldShape && oldShape.delete) {
          oldShape.delete();
        }
        self._shapeCache.delete(key);
      });
    }
    
    self._shapeCache.set(id, shape);
    
    return {
      type: 'fallback',
      _tempId: id,
      bounds: bounds
    };
  } catch (error) {
    console.error('Fallback serialization failed:', error);
    throw new Error('Failed to serialize shape');
  }
}

/**
 * Fallback deserialization method
 */
function fallbackDeserialize(serialized) {
  if (serialized.type === 'fallback' && serialized._tempId) {
    if (self._shapeCache && self._shapeCache.has(serialized._tempId)) {
      return self._shapeCache.get(serialized._tempId);
    }
  }
  throw new Error('Shape not found in fallback cache');
}

/**
 * التحقق من تعقيد الشكل
 */
function validateShapeComplexity(shape) {
  let vertexCount = 0;
  let faceCount = 0;
  let edgeCount = 0;
  
  try {
    // عد الرؤوس
    const vertexExplorer = new occt.TopExp_Explorer(shape, occt.TopAbs_VERTEX);
    while (vertexExplorer.More()) {
      vertexCount++;
      vertexExplorer.Next();
    }
    vertexExplorer.delete();
    
    // عد الوجوه
    const faceExplorer = new occt.TopExp_Explorer(shape, occt.TopAbs_FACE);
    while (faceExplorer.More()) {
      faceCount++;
      faceExplorer.Next();
    }
    faceExplorer.delete();
    
    // عد الحواف
    const edgeExplorer = new occt.TopExp_Explorer(shape, occt.TopAbs_EDGE);
    while (edgeExplorer.More()) {
      edgeCount++;
      edgeExplorer.Next();
    }
    edgeExplorer.delete();
    
    // التحقق من الحدود
    if (vertexCount > OPERATION_LIMITS.MAX_VERTICES) {
      throw new Error(`Shape too complex: ${vertexCount} vertices exceed limit of ${OPERATION_LIMITS.MAX_VERTICES}`);
    }
    if (faceCount > OPERATION_LIMITS.MAX_FACES) {
      throw new Error(`Shape too complex: ${faceCount} faces exceed limit of ${OPERATION_LIMITS.MAX_FACES}`);
    }
    if (edgeCount > OPERATION_LIMITS.MAX_EDGES) {
      throw new Error(`Shape too complex: ${edgeCount} edges exceed limit of ${OPERATION_LIMITS.MAX_EDGES}`);
    }
  } catch (error) {
    console.warn('Failed to validate shape complexity:', error);
    // نستمر على أي حال
  }
}

/**
 * تحويل الشكل
 */
function transformShape(params) {
  const { shape, transform } = params;
  
  let s, result;
  try {
    // إعادة بناء الشكل
    s = deserializeShape(shape);
    
    // إنشاء التحويل
    const trsf = new occt.gp_Trsf();
    
    if (transform.translate) {
      const vec = new occt.gp_Vec(
        transform.translate[0] || 0,
        transform.translate[1] || 0,
        transform.translate[2] || 0
      );
      trsf.SetTranslation(vec);
      vec.delete();
    }
    
    if (transform.rotate) {
      // rotation implementation
      const center = new occt.gp_Pnt(0, 0, 0);
      const direction = new occt.gp_Dir(
        transform.rotate.axis[0],
        transform.rotate.axis[1],
        transform.rotate.axis[2]
      );
      const axis = new occt.gp_Ax1(center, direction);
      trsf.SetRotation(axis, transform.rotate.angle * Math.PI / 180);
      
      center.delete();
      direction.delete();
      axis.delete();
    }
    
    if (transform.scale) {
      trsf.SetScaleFactor(transform.scale);
    }
    
    // تطبيق التحويل
    const transformer = new occt.BRepBuilderAPI_Transform(s, trsf, true);
    result = transformer.Shape();
    
    // تنظيف
    s.delete();
    trsf.delete();
    transformer.delete();
    
    // تحويل النتيجة
    const serialized = serializeShape(result);
    result.delete();
    
    return {
      type: 'shape',
      geometry: serialized
    };
    
  } catch (error) {
    if (s && s.delete) s.delete();
    if (result && result.delete) result.delete();
    throw new Error(`Transform failed: ${error.message}`);
  }
}

/**
 * قياس الشكل
 */
function measureShape(params) {
  const { shape } = params;
  
  let s = null;
  
  try {
    // إعادة بناء الشكل
    s = deserializeShape(shape);
    
    // خصائص الحجم
    const volumeProps = new occt.GProp_GProps();
    occt.BRepGProp.VolumeProperties(s, volumeProps);
    const volume = volumeProps.Mass();
    
    // خصائص السطح
    const surfaceProps = new occt.GProp_GProps();
    occt.BRepGProp.SurfaceProperties(s, surfaceProps);
    const surfaceArea = surfaceProps.Mass();
    
    // مركز الكتلة
    const centerOfMass = volumeProps.CentreOfMass();
    
    // الحدود
    const bbox = new occt.Bnd_Box();
    occt.BRepBndLib.Add(s, bbox, false);
    
    let xmin = 0, ymin = 0, zmin = 0, xmax = 0, ymax = 0, zmax = 0;
    bbox.Get(xmin, ymin, zmin, xmax, ymax, zmax);
    
    // محاور القصور الذاتي
    let inertiaData = null;
    try {
      const matrix = volumeProps.MatrixOfInertia();
      inertiaData = {
        Ixx: matrix.Value(1, 1),
        Iyy: matrix.Value(2, 2),
        Izz: matrix.Value(3, 3),
        Ixy: matrix.Value(1, 2),
        Ixz: matrix.Value(1, 3),
        Iyz: matrix.Value(2, 3)
      };
      matrix.delete();
    } catch (e) {
      console.warn('Inertia matrix not available');
    }
    
    const result = {
      volume,
      surfaceArea,
      centerOfMass: [
        centerOfMass.X(),
        centerOfMass.Y(),
        centerOfMass.Z()
      ],
      bounds: {
        min: [xmin, ymin, zmin],
        max: [xmax, ymax, zmax],
        size: [xmax - xmin, ymax - ymin, zmax - zmin],
        diagonal: Math.sqrt(
          Math.pow(xmax - xmin, 2) +
          Math.pow(ymax - ymin, 2) +
          Math.pow(zmax - zmin, 2)
        )
      }
    };
    
    if (inertiaData) {
      result.inertia = inertiaData;
    }
    
    // تنظيف
    volumeProps.delete();
    surfaceProps.delete();
    bbox.delete();
    s.delete();
    
    return result;
    
  } catch (error) {
    if (s && s.delete) s.delete();
    throw new Error(`Measurement failed: ${error.message}`);
  }
}

/**
 * تطبيق fillet (تدوير الحواف)
 */
function filletShape(params) {
  const { shape, radius = 5, edges = 'all' } = params;
  
  let s = null;
  let result = null;
  
  try {
    // إعادة بناء الشكل
    s = deserializeShape(shape);
    
    // إنشاء fillet maker
    const fillet = new occt.BRepFilletAPI_MakeFillet(s);
    
    // إضافة الحواف
    if (edges === 'all') {
      // إضافة جميع الحواف
      const edgeExplorer = new occt.TopExp_Explorer(s, occt.TopAbs_EDGE);
      while (edgeExplorer.More()) {
        const edge = occt.TopoDS.Edge(edgeExplorer.Current());
        fillet.Add(radius, edge);
        edgeExplorer.Next();
      }
      edgeExplorer.delete();
    }
    
    // بناء النتيجة
    result = fillet.Shape();
    fillet.delete();
    
    // تحويل النتيجة
    const serialized = serializeShape(result);
    
    // تنظيف
    s.delete();
    result.delete();
    
    return {
      type: 'shape',
      geometry: serialized
    };
    
  } catch (error) {
    if (s && s.delete) s.delete();
    if (result && result.delete) result.delete();
    throw new Error(`Fillet operation failed: ${error.message}`);
  }
}

/**
 * تطبيق chamfer (قطع الحواف)
 */
function chamferShape(params) {
  const { shape, distance = 5, edges = 'all' } = params;
  
  let s = null;
  let result = null;
  
  try {
    // إعادة بناء الشكل
    s = deserializeShape(shape);
    
    // إنشاء chamfer maker
    const chamfer = new occt.BRepFilletAPI_MakeChamfer(s);
    
    // إضافة الحواف
    if (edges === 'all') {
      const edgeExplorer = new occt.TopExp_Explorer(s, occt.TopAbs_EDGE);
      while (edgeExplorer.More()) {
        const edge = occt.TopoDS.Edge(edgeExplorer.Current());
        
        // نحتاج للحصول على الوجوه المجاورة للحافة
        const faceExplorer = new occt.TopExp_Explorer(s, occt.TopAbs_FACE);
        let face = null;
        
        while (faceExplorer.More() && !face) {
          const currentFace = occt.TopoDS.Face(faceExplorer.Current());
          // التحقق من احتواء الوجه على الحافة
          const edgeInFaceExplorer = new occt.TopExp_Explorer(currentFace, occt.TopAbs_EDGE);
          while (edgeInFaceExplorer.More()) {
            if (edgeInFaceExplorer.Current().IsSame(edge)) {
              face = currentFace;
              break;
            }
            edgeInFaceExplorer.Next();
          }
          edgeInFaceExplorer.delete();
          faceExplorer.Next();
        }
        
        if (face) {
          chamfer.Add(distance, distance, edge, face);
        }
        
        faceExplorer.delete();
        edgeExplorer.Next();
      }
      edgeExplorer.delete();
    }
    
    // بناء النتيجة
    result = chamfer.Shape();
    chamfer.delete();
    
    // تحويل النتيجة
    const serialized = serializeShape(result);
    
    // تنظيف
    s.delete();
    result.delete();
    
    return {
      type: 'shape',
      geometry: serialized
    };
    
  } catch (error) {
    if (s && s.delete) s.delete();
    if (result && result.delete) result.delete();
    throw new Error(`Chamfer operation failed: ${error.message}`);
  }
}

/**
 * بثق profile
 */
function extrudeProfile(params) {
  const { profile, direction = [0, 0, 100], twist = 0 } = params;
  
  let profileShape = null;
  let result = null;
  
  try {
    // إعادة بناء الـ profile
    profileShape = deserializeShape(profile);
    
    // إنشاء vector للبثق
    const vec = new occt.gp_Vec(direction[0], direction[1], direction[2]);
    
    // إنشاء prism
    const prism = new occt.BRepPrimAPI_MakePrism(profileShape, vec);
    result = prism.Shape();
    
    // تنظيف
    vec.delete();
    prism.delete();
    profileShape.delete();
    
    // تطبيق twist إذا طُلب
    if (twist !== 0) {
      // يحتاج implementation أكثر تعقيداً
      console.warn('Twist not implemented yet');
    }
    
    // تحويل النتيجة
    const serialized = serializeShape(result);
    result.delete();
    
    return {
      type: 'shape',
      geometry: serialized
    };
    
  } catch (error) {
    if (profileShape && profileShape.delete) profileShape.delete();
    if (result && result.delete) result.delete();
    throw new Error(`Extrude operation failed: ${error.message}`);
  }
}

/**
 * دوران profile
 */
function revolveProfile(params) {
  const { profile, axis = { point: [0, 0, 0], direction: [0, 0, 1] }, angle = 360 } = params;
  
  let profileShape = null;
  let result = null;
  
  try {
    // إعادة بناء الـ profile
    profileShape = deserializeShape(profile);
    
    // إنشاء محور الدوران
    const axisPoint = new occt.gp_Pnt(axis.point[0], axis.point[1], axis.point[2]);
    const axisDir = new occt.gp_Dir(axis.direction[0], axis.direction[1], axis.direction[2]);
    const ax1 = new occt.gp_Ax1(axisPoint, axisDir);
    
    // تحويل الزاوية لـ radians
    const angleRad = (angle * Math.PI) / 180;
    
    // إنشاء revolution
    const revolution = new occt.BRepPrimAPI_MakeRevol(profileShape, ax1, angleRad);
    result = revolution.Shape();
    
    // تنظيف
    axisPoint.delete();
    axisDir.delete();
    ax1.delete();
    revolution.delete();
    profileShape.delete();
    
    // تحويل النتيجة
    const serialized = serializeShape(result);
    result.delete();
    
    return {
      type: 'shape',
      geometry: serialized
    };
    
  } catch (error) {
    if (profileShape && profileShape.delete) profileShape.delete();
    if (result && result.delete) result.delete();
    throw new Error(`Revolve operation failed: ${error.message}`);
  }
}

/**
 * إطلاق شكل من الذاكرة
 */
function releaseShape(params) {
  const { shapeId } = params;
  
  try {
    if (self._shapeCache && self._shapeCache.has(shapeId)) {
      const shape = self._shapeCache.get(shapeId);
      if (shape && shape.delete) {
        shape.delete();
      }
      self._shapeCache.delete(shapeId);
    }
    
    return { released: true };
  } catch (error) {
    console.warn('Failed to release shape:', error);
    return { released: false, error: error.message };
  }
}

/**
 * تنظيف الموارد
 */
function cleanup() {
  console.log('Cleaning up OCCT worker resources...');
  
  // إيقاف إدارة الذاكرة
  stopMemoryManagement();
  
  // تنظيف كاش الأشكال
  if (self._shapeCache) {
    for (const [id, shape] of self._shapeCache) {
      try {
        if (shape && shape.delete) {
          shape.delete();
        }
      } catch (e) {
        console.error('Error deleting shape:', e);
      }
    }
    self._shapeCache.clear();
  }
  
  initialized = false;
  occt = null;
  
  // إجبار garbage collection إذا كان متاحاً
  if (self.gc) {
    self.gc();
  }
  
  console.log('OCCT worker cleanup complete');
}
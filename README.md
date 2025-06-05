# TyrexCAD - ثورة في عالم التصميم بمساعدة الحاسوب

![TyrexCAD Logo](https://img.shields.io/badge/TyrexCAD-Revolutionary%20CAD-blue)

> نظام CAD ثوري مبني على عمارة الرسائل مع عزل كامل للوحدات

![Version](https://img.shields.io/badge/version-0.2.0-green)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18.0.0-brightgreen)

## 📖 جدول المحتويات

- [نظرة عامة](#-نظرة-عامة)
- [المشكلة التي نحلها](#-المشكلة-التي-نحلها)
- [الحل: عمارة الرسائل](#-الحل-عمارة-الرسائل)
- [البنية التقنية](#-البنية-التقنية)
- [ما تم إنجازه](#-ما-تم-إنجازه)
- [دليل التشغيل](#-دليل-التشغيل)
- [دليل المطورين](#-دليل-المطورين)
- [خريطة الطريق](#-خريطة-الطريق)
- [المساهمة](#-المساهمة)

## 🌟 نظرة عامة

TyrexCAD ليس مجرد برنامج CAD آخر. إنه نموذج جديد كلياً في بناء أنظمة التصميم المعقدة. تخيل نظاماً حيث كل مكون معزول تماماً، يتواصل فقط عبر الرسائل، ويمكن تطويره وصيانته وتوسيعه بشكل مستقل دون المساس بباقي النظام.

### الرؤية

نحن نبني منصة CAD حيث:

- **البساطة تلتقي بالقوة**: كل وحدة بسيطة في حد ذاتها، لكن معاً تشكل نظاماً قوياً
- **التوسع بلا حدود**: أضف مزايا جديدة دون لمس السطر الواحد من الكود الموجود
- **الصيانة سهلة**: عندما يحدث خطأ، تعرف بالضبط أين تبحث
- **التعاون ممكن**: عدة مطورين يعملون على وحدات مختلفة دون تداخل
- **AI-Friendly**: كل وحدة يمكن فهمها بمعزل عن الباقي

## 🔥 المشكلة التي نحلها

أنظمة CAD التقليدية تعاني من "متلازمة السباغيتي" - تشابك معقد من التبعيات حيث:

```
Traditional CAD Architecture:
┌─────────────┐
│   UI Layer  │──┐
├─────────────┤  │  
│   Tools     │──┼──┐
├─────────────┤  │  │
│  Geometry   │<─┼──┤  كل شيء يعتمد على كل شيء!
├─────────────┤  │  │
│  Viewport   │<─┼──┤
├─────────────┤  │  │
│   Storage   │<─┘──┘
└─────────────┘
```

**النتيجة؟**
- إصلاح خطأ بسيط يتطلب فهم النظام بأكمله
- إضافة ميزة جديدة تعني تعديل الكود الموجود
- الصيانة تصبح كابوساً مع نمو المشروع
- التعاون بين المطورين صعب للغاية
- اختبار أي جزء يتطلب تشغيل النظام كاملاً

## 💡 الحل: عمارة الرسائل

TyrexCAD يعتمد على مبدأ بسيط وقوي: **كل مكون معزول تماماً ويتواصل فقط عبر الرسائل**.

```
TyrexCAD Message-Based Architecture:
┌─────────────┐     Messages      ┌─────────────┐
│   Module A  │ ←───────────────→ │   Module B  │
└─────────────┘                    └─────────────┘
       ↑                                    ↑
       │              Message Bus           │
       └────────────────┬───────────────────┘
                        │
                 ┌──────┴──────┐
                 │ Message Bus │  القلب النابض
                 │  (Router)    │  لا يعرف محتوى الرسائل
                 └──────┬──────┘
                        │
       ┌────────────────┼────────────────┐
       ↓                ↓                ↓
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Module C  │  │   Module D  │  │   Module E  │
└─────────────┘  └─────────────┘  └─────────────┘
```

### مثال عملي: كيف يعمل النظام

تخيل أن المستخدم يريد رسم مربع:

```javascript
// 1. أداة الرسم ترسل رسالة
messageBus.emit('geometry.create', {
  type: 'box',
  dimensions: { width: 100, height: 100, depth: 50 }
});

// 2. وحدة الهندسة تستقبل وتعالج
// في ملف منفصل تماماً، لا تعرف من أرسل الرسالة
geometryModule.on('geometry.create', async (message) => {
  const shape = await createShape(message.data);
  
  // ترسل رسالة بالنجاح
  messageBus.emit('geometry.created', {
    id: shape.id,
    mesh: shape.mesh
  });
});

// 3. وحدة العرض تستقبل وتعرض
// في ملف آخر منفصل، لا تعرف كيف تم إنشاء الشكل
viewportModule.on('geometry.created', (message) => {
  scene.add(message.data.mesh);
  render();
});
```

## 🏗️ البنية التقنية

### طبقات النظام

#### 1. The Sealed Core (القلب المحكم)
بعد الإصدار 1.0، هذه الملفات لا تُعدل أبداً:

**Message Bus: ناقل الرسائل المركزي**
- يعالج 50,000+ رسالة/ثانية
- زمن استجابة < 1ms
- نظام أولويات ذكي
- حماية من الضغط الزائد

**Module Loader: محمل الوحدات**
- تحميل ديناميكي للوحدات
- حقن MessageAPI معزول لكل وحدة
- دعم Hot Reloading للتطوير

**Lifecycle Manager: مدير دورة الحياة**
- Health checks دورية
- إعادة تشغيل تلقائية للوحدات الفاشلة
- إيقاف آمن مع حفظ البيانات

**OCCT Bridge: جسر OpenCASCADE**
- تكامل مع محرك CAD القوي
- Worker Pool للعمليات الثقيلة
- إدارة ذاكرة ذكية

#### 2. Core Modules (الوحدات الأساسية)
كل وحدة:
- **معزولة تماماً**: لا imports من وحدات أخرى
- **مستقلة**: يمكن فهمها واختبارها منفردة
- **متواصلة بالرسائل**: كل التفاعل عبر MessageAPI

**الوحدات المنجزة:**

**Storage Module**  
يوفر تخزين موحد عبر المنصات:
```javascript
// نفس الكود يعمل في المتصفح و Electron
await messageBus.request('storage.set', {
  key: 'project.current',
  value: projectData
});
```

**Resources Module**  
يجرّد تحميل الموارد (WASM, assets, etc):
```javascript
// يعمل مع URLs أو ملفات محلية
const wasmModule = await messageBus.request('resources.load', {
  resource: 'opencascade.wasm',
  type: 'wasm'
});
```

**Shell Module**  
واجهة مستخدم مجردة عن إطار العمل:
```javascript
// يمكن استبدال React/Vue/Svelte دون تغيير الكود
messageBus.emit('shell.showStatus', {
  text: 'تم حفظ المشروع',
  type: 'success'
});
```

**Desktop Features Module**  
مزايا خاصة بسطح المكتب:
```javascript
// يعمل في Electron فقط، يفشل بأمان في المتصفح
const file = await messageBus.request('desktop.openFile', {
  filters: [
    { name: 'CAD Files', extensions: ['step', 'iges'] }
  ]
});
```

**Geometry Test Module**  
اختبار وإدارة الأشكال الهندسية:
```javascript
// إنشاء أشكال ثلاثية الأبعاد
const box = await messageBus.request('geometry-test.createBox', {
  width: 100,
  height: 100,
  depth: 100,
  center: true
});
```

**Viewport Module**  
عرض ثلاثي الأبعاد باستخدام Three.js:
```javascript
// إضافة شكل للمشهد
messageBus.emit('viewport.addMesh', {
  shapeId: 'shape_1',
  mesh: meshData,
  material: { color: 0x2194ce }
});
```

### هيكل المشروع
```
tyrexcad/
├── core/                      # القلب المحكم (لا يُعدل بعد v1.0)
│   ├── message-bus.js         # ناقل الرسائل المركزي
│   ├── module-loader.js       # محمل الوحدات
│   ├── lifecycle.js           # إدارة دورة الحياة
│   └── occt-bridge.js         # جسر OpenCASCADE
│
├── modules/                   # الوحدات الأساسية
│   ├── storage/               # تجريد التخزين
│   ├── resources/             # تحميل الموارد
│   ├── shell/                 # واجهة المستخدم
│   ├── desktop-features/      # مزايا سطح المكتب
│   ├── geometry-test/         # اختبار الأشكال الهندسية
│   └── viewport/              # العرض ثلاثي الأبعاد
│
├── public/
│   └── workers/               # Web Workers
│       └── occt-worker.js     # معالج العمليات الهندسية
│
├── desktop/                   # ملفات Electron
│   ├── main.js               # العملية الرئيسية
│   └── preload.js            # جسر آمن للـ renderer
│
└── tests/                     # اختبارات معزولة لكل وحدة
```

## ✅ ما تم إنجازه

### Phase 1: Foundation (100% مكتمل)
- ✅ Message Bus بأداء عالي (50k+ msg/s)
- ✅ Module Loader مع عزل كامل
- ✅ Lifecycle Manager مع health checks
- ✅ وحدات تجريبية (Echo, Counter)
- ✅ نظام اختبار شامل

### Phase 1.5: Platform Abstraction (100% مكتمل)
- ✅ Storage Module - تخزين موحد عبر المنصات
- ✅ Resources Module - تحميل موارد مجرد
- ✅ Shell Module - واجهة مستخدم قابلة للاستبدال
- ✅ Desktop Support - تطبيق Electron كامل

### Phase 2: OCCT Integration (100% مكتمل)
- ✅ OCCT WebAssembly Bridge مع Worker Pool
- ✅ Geometry Test Module للأشكال الهندسية
- ✅ Viewport Module مع Three.js
- ✅ عمليات Boolean (union, subtract, intersect)
- ✅ تحويل الأشكال لـ meshes

### الإحصائيات الحالية
- **عدد الملفات**: 42 ملف
- **عدد الأسطر**: ~5,000 سطر كود نظيف
- **تغطية الاختبارات**: 180+ اختبار ناجح
- **الوحدات النشطة**: 8 وحدات
- **الأداء**: 50,000+ رسالة/ثانية

## 🚀 دليل التشغيل

### المتطلبات
- Node.js >= 18.0.0
- npm أو yarn

### التثبيت
```bash
# استنساخ المشروع
git clone https://github.com/tyrexcad/tyrexcad.git
cd tyrexcad

# تثبيت التبعيات
npm install
```

### تشغيل كتطبيق ويب
```bash
npm run dev
```
افتح المتصفح على http://localhost:5173

في وحدة التحكم (Console)، جرب:
```javascript
// الوصول للنظام
const tc = window.__tyrexcad;

// إرسال رسالة
tc.emit('shell.showStatus', { 
  text: 'مرحباً بك في TyrexCAD!',
  type: 'success' 
});

// إنشاء شكل ثلاثي الأبعاد
const box = await tc.request('geometry-test.createBox', {
  width: 100,
  height: 100,
  depth: 100
});

// معلومات النظام
const stats = await tc.request('occt.info');
console.log(stats);
```

### تشغيل كتطبيق سطح مكتب
```bash
npm run dev:desktop
```
يفتح نافذة Electron مع مزايا إضافية:
- فتح/حفظ الملفات المحلية
- قوائم نظام التشغيل
- تكامل أعمق مع النظام

### الاختبارات
```bash
# جميع الاختبارات
npm test

# اختبار وحدة محددة
npm test -- tests/modules/storage.test.js

# مع تغطية الكود
npm run test:coverage

# واجهة رسومية للاختبارات
npm run test:ui
```

## 👨‍💻 دليل المطورين

### إضافة وحدة جديدة

إنشاء وحدة جديدة سهل للغاية. كل ما تحتاجه هو فهم MessageAPI:

#### 1. أنشئ مجلد الوحدة
```bash
mkdir modules/my-feature
touch modules/my-feature/index.js
```

#### 2. اكتب الوحدة
```javascript
// modules/my-feature/index.js
export default class MyFeatureModule {
  constructor(messageAPI) {
    this.msg = messageAPI;  // الطريقة الوحيدة للتواصل
    this.version = '1.0.0';
    
    // الحالة الداخلية - معزولة تماماً
    this.state = new Map();
    
    this.setupHandlers();
    
    // أعلن أن الوحدة جاهزة
    this.msg.emit('myfeature.ready', { version: this.version });
  }
  
  setupHandlers() {
    // استمع للرسائل
    this.msg.on('myfeature.doSomething', async (message) => {
      try {
        const result = await this.processRequest(message.data);
        
        // رد على الطلب
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: true,
            result
          });
        }
        
        // بث حدث للآخرين
        this.msg.emit('myfeature.somethingDone', result);
        
      } catch (error) {
        // معالجة الأخطاء دائماً
        if (message.requestId) {
          this.msg.reply(message.requestId, {
            success: false,
            error: error.message
          });
        }
      }
    });
  }
  
  async processRequest(data) {
    // منطق عملك هنا
    this.state.set(data.id, data.value);
    return { processed: true };
  }
  
  // دورة الحياة (اختيارية)
  async start() {
    console.log('MyFeature module started');
  }
  
  async stop() {
    // تنظيف الموارد
    this.state.clear();
  }
  
  async healthCheck() {
    // صحة الوحدة
    return this.state.size < 10000;
  }
  
  async cleanup() {
    this.msg.off('myfeature.*');
    this.state.clear();
  }
}
```

#### 3. سجل وحمّل الوحدة
في `main.js`:
```javascript
import MyFeatureModule from './modules/my-feature/index.js';

// في دالة initializeTyrexCad
moduleLoader.registerModuleType('my-feature', MyFeatureModule);
await moduleLoader.loadModule('my-feature');
```

#### 4. اكتب اختبارات
```javascript
// tests/modules/my-feature.test.js
import { describe, test, expect } from 'vitest';
import MyFeatureModule from '../../modules/my-feature/index.js';

describe('MyFeatureModule', () => {
  test('should process requests', async () => {
    const mockAPI = createMockMessageAPI();
    const module = new MyFeatureModule(mockAPI);
    
    // اختبر بمعزل تام
    await mockAPI.trigger('myfeature.doSomething', {
      id: 'test',
      value: 42
    });
    
    expect(mockAPI.emit).toHaveBeenCalledWith(
      'myfeature.somethingDone',
      expect.any(Object)
    );
  });
});
```

### القواعد الذهبية للتطوير

#### 1. العزل التام
```javascript
// ❌ خطأ - لا imports بين الوحدات
import GeometryModule from '../geometry';

// ✅ صحيح - تواصل بالرسائل فقط
const result = await this.msg.request('geometry.create', data);
```

#### 2. معالجة الأخطاء دائماً
```javascript
// ❌ خطأ - بدون معالجة أخطاء
this.msg.on('myfeature.action', (message) => {
  const result = this.riskyOperation();
  this.msg.reply(message.requestId, { success: true, result });
});

// ✅ صحيح - معالجة شاملة
this.msg.on('myfeature.action', async (message) => {
  try {
    const result = await this.riskyOperation();
    if (message.requestId) {
      this.msg.reply(message.requestId, { success: true, result });
    }
  } catch (error) {
    console.error('Action failed:', error);
    if (message.requestId) {
      this.msg.reply(message.requestId, { 
        success: false, 
        error: error.message 
      });
    }
  }
});
```

#### 3. رسائل واضحة ومنظمة
```javascript
// ❌ خطأ - أسماء غامضة
this.msg.emit('update', data);

// ✅ صحيح - تسلسل هرمي واضح
this.msg.emit('viewport.camera.update', {
  position: { x: 0, y: 10, z: 50 },
  target: { x: 0, y: 0, z: 0 }
});
```

### نصائح الأداء

#### 1. استخدم الأولويات للرسائل الحرجة
```javascript
// رسائل تفاعل المستخدم - أولوية عالية
this.msg.emit('tool.activated', data, { priority: 'high' });

// تحديثات دورية - أولوية منخفضة
this.msg.emit('stats.update', data, { priority: 'low' });
```

#### 2. دفعات للعمليات المتعددة
```javascript
// ❌ بطيء - رسالة لكل عنصر
shapes.forEach(shape => {
  this.msg.emit('shape.update', shape);
});

// ✅ سريع - رسالة واحدة بدفعة
this.msg.emit('shapes.batchUpdate', { shapes });
```

#### 3. استخدم الكاش بحكمة
```javascript
// في وحدة الموارد
if (this.cache.has(resourceKey)) {
  return this.cache.get(resourceKey);
}
const resource = await this.loadResource(resourceKey);
this.cache.set(resourceKey, resource);
return resource;
```

## 🗺️ خريطة الطريق

### Phase 3: Core CAD Features (قيد التطوير)
- [ ] Geometry Module الكامل مع spatial indexing
- [ ] أدوات الرسم المتقدمة (خط، دائرة، قوس، spline)
- [ ] نظام Undo/Redo متقدم
- [ ] نظام Layers والتنظيم

### Phase 4: Advanced Features
- [ ] محرك Parametric كامل
- [ ] نظام Constraints (2D & 3D)
- [ ] استيراد/تصدير متقدم (STEP, IGES, STL, DXF)
- [ ] التعاون المباشر real-time

### Phase 5: Ecosystem
- [ ] Plugin Marketplace
- [ ] محرر مرئي للـ workflows
- [ ] تكامل AI للتصميم الذكي
- [ ] تطبيقات الموبايل (iOS/Android)

### Phase 6: Enterprise Features
- [ ] نظام إدارة المشاريع
- [ ] تكامل مع PLM systems
- [ ] Advanced simulation
- [ ] Cloud rendering

## 🤝 المساهمة

نرحب بالمساهمات! لكن يرجى اتباع قواعدنا الصارمة:

### قبل المساهمة
1. **اقرأ المبادئ**: افهم فلسفة العزل التام
2. **شغل الاختبارات**: تأكد أن كل شيء يعمل
3. **تحقق من العزل**: `npm run check-isolation`

### عملية المساهمة
1. Fork المشروع
2. أنشئ فرع للميزة: `git checkout -b feature/amazing-feature`
3. اكتب كود نظيف مع اختبارات
4. تأكد من العزل: لا imports بين الوحدات
5. Commit: `git commit -m 'Add amazing feature'`
6. Push: `git push origin feature/amazing-feature`
7. افتح Pull Request

### معايير المراجعة
كل PR يجب أن:
- ✅ يحافظ على العزل التام
- ✅ يتضمن اختبارات (تغطية > 80%)
- ✅ يتبع نمط الرسائل
- ✅ يوثق الرسائل الجديدة
- ✅ يعالج جميع الأخطاء
- ✅ لا يعدل ملفات `core/` بعد v1.0

## 📄 الرخصة

هذا المشروع مرخص تحت رخصة MIT - انظر ملف [LICENSE](LICENSE) للتفاصيل.


<p align="center">
  صُنع بـ ❤️ بواسطة مجتمع TyrexCAD
</p>
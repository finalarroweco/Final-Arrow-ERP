import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../language-switcher";
export default async function ReleaseStatusPage(){
 if(!await currentUser())redirect("/login");const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const groups=[
 {title:t("Implemented workflows","مسارات مطوّرة"),description:t("These modules have scoped application workflows and automated checks. Business acceptance with actual operating rules remains required.","تحتوي هذه الأقسام على مسارات عمل وصلاحيات وفحوص آلية. ما زال اعتمادها مع قواعد العمل الفعلية مطلوبًا."),items:[
 ["/settings/payment-terms",t("Company payment-term templates with permanent definitions, reasoned archive and explicit copying to new documents","قوالب شروط دفع الشركة بتعريفات ثابتة وأرشفة بسبب ونسخ صريح إلى المستندات الجديدة")],
 ["/saved-reports",t("Private reusable presets for customer/supplier balances and aging, plus invoice, expense, quote, sales-order and purchase-order registers","إعدادات خاصة قابلة لإعادة الاستخدام لأرصدة وأعمار العملاء والموردين وسجلات الفواتير والمصاريف وعروض الأسعار وطلبات البيع وأوامر الشراء")],
 ["/data-import",t("CSV import for customers, suppliers and catalog items with preview and atomic audited batches","استيراد العملاء والموردين والأصناف من CSV بمعاينة ودفعات مدققة تُحفظ كاملة")],
 ["/crm",t("CRM, customers, contacts, quotes and sales orders","إدارة العملاء وجهات الاتصال وعروض الأسعار وطلبات البيع")],
 ["/purchasing/orders",t("Purchases, partial receipts, returns and source settlements","المشتريات والاستلام الجزئي والمرتجعات والتسويات المرتبطة")],
 ["/accounting/vat-settings",t("Optional Oman VAT snapshots for invoices, purchase receipts/returns, expenses and POS; internal accounting only","لقطات ضريبة القيمة المضافة العُمانية الاختيارية للفواتير واستلام المشتريات ومرتجعاتها والمصروفات ونقاط البيع؛ للمحاسبة الداخلية فقط")],
 ["/accounting/bank",t("Actor-bound bank imports, permanent pending-request abandonment, partial/split allocations and immutable internal reconciliation snapshots","استيراد بنكي مرتبط بالمستخدم وإلغاء نهائي للطلبات المعلقة وتخصيصات جزئية ومقسمة ولقطات تسوية داخلية ثابتة")],
 ["/accounting/ledger",t("Source journals, corrections, period locks and financial reports","قيود المستندات والعكس وإقفال الفترات والتقارير المالية")],
 ["/purchasing/rfqs",t("Supplier RFQs, versioned offers and explicit draft purchase-order selection with scoped recovery","طلبات عروض أسعار الموردين وعروض بإصدارات محفوظة واختيار صريح لإنشاء أمر شراء مسودة مع تعافٍ ضمن الصلاحيات")],
 ["/inventory/stock",t("Manual stock reservations, available quantities and permanent release history","حجز المخزون اليدوي والكميات المتاحة وسجل فك الحجز الدائم")],
 ["/inventory/reordering",t("Explicit branch/item reorder thresholds and coherent current shortage observations, with unit-change review and no automatic purchases","حدود إعادة طلب صريحة للصنف والفرع ورصد متسق للنقص الحالي مع مراجعة تغيّر الوحدة ودون شراء تلقائي")],
 ["/inventory/transfers",t("Completed same-company branch stock transfers with paired corrections, two-branch authorization and safe pending-request cancellation","تسجيل تحويلات مخزون مكتملة بين فروع الشركة مع تصحيح مزدوج وصلاحيات للفرعين وإلغاء آمن للطلبات المعلّقة")],
 ["/sales/orders",t("Order-linked stock holds, manual physical deliveries, usable-stock returns and atomic delivery of one explicitly selected full hold","حجوزات مخزون مرتبطة بطلبات البيع وتسليم فعلي يدوي ومرتجعات صالحة وتسليم كامل حجز مختار صراحةً في عملية واحدة")],
 ["/accounting/customer-overdue",t("Audited invoice/receipt payment-term amendments, immutable originals and historical customer/supplier due-date aging","تعديلات مدققة لشروط دفع الفواتير والاستلام مع حفظ الأصل وتقارير استحقاقات تاريخية للعملاء والموردين")],
 ["/accounting/customer-aging",t("Customer and supplier balances, statements and posting-date aging","أرصدة وكشوف العملاء والموردين وأعمار الأرصدة من تاريخ القيد")],
 ["/pos",t("POS, saved VAT, full/partial refunds, drawer shifts and cash counting","نقاط البيع والضريبة المحفوظة والاسترداد الكامل والجزئي وورديات الصندوق والعدّ")],
 ["/hr/payroll",t("Employee, attendance, leave and manual payroll workflows","الموظفون والحضور والإجازات ومسارات الرواتب اليدوية")],
 ["/projects/workload",t("Cross-project employee workload, current task due buckets and recorded time by review status","عبء عمل الموظفين عبر المشاريع وتصنيف مواعيد المهام الحالية والساعات حسب حالة المراجعة")],
 ["/projects",t("Projects, linked invoice/collection tracking, manual budgets/costs, tasks, prerequisite dependencies, assignments, time recording and independent time review","المشاريع ومتابعة الفواتير والتحصيلات المرتبطة والميزانيات والتكاليف اليدوية والمهام والمتطلبات السابقة والتكليف وتسجيل الوقت واعتماده بصلاحية مستقلة")],
 ["/private-alerts",t("Private configured ticket, subscription-review and stock-shortage observations with explicit manual evaluation and safe request recovery","ملاحظات خاصة لمواعيد التذاكر ومراجعة الاشتراكات ونقص المخزون بقواعد صريحة وتقييم يدوي وتعافٍ آمن للطلبات")],
 ["/helpdesk/deadlines",t("Manual ticket deadlines, permanent change history and current overdue register","مواعيد التذاكر اليدوية وسجل تغييراتها الدائم وسجل التأخير الحالي")],
 ["/manual-subscriptions",t("Manual customer subscription register with explicit status/review dates, immutable history and independent customer access checks","سجل يدوي لاشتراكات العملاء بحالات ومواعيد مراجعة صريحة وسجل محفوظ وفحص مستقل لصلاحية العميل")],
 ["/documents",t("Internal plain-text documents with scoped access, immutable revisions, explicit archive/restore and safe request recovery","مستندات نصية داخلية بصلاحيات محددة وإصدارات محفوظة وأرشفة واستعادة صريحة وتعافٍ آمن للطلبات")],
 ["/helpdesk",t("Ticket workflow and permanent internal follow-up","مسار التذاكر وسجل المتابعة الداخلية الدائم")]]},
 {title:t("Remaining product development","تطوير منتج متبقٍ"),description:t("These items require additional implementation and verification; existing module screens do not mean these capabilities are complete.","تحتاج هذه البنود إلى تنفيذ وفحص إضافيين؛ وجود شاشة القسم لا يعني اكتمال هذه الإمكانات."),items:[
 ["",t("Sales: unallocated advances and statutory documents","المبيعات: الدفعات غير المخصصة والمستندات النظامية")],
 ["",t("Inventory: automatic commercial fulfilment/allocation, unit conversion, valuation and supplier advances","المخزون: تنفيذ الكميات التجارية والتخصيص تلقائيًا وتحويل الوحدات والتقييم ودفعات الموردين المقدمة")],
 ["",t("Projects: invoice generation from time/milestones, capacity calendars/estimates and automatic cost allocations","المشاريع: توليد الفواتير من الساعات والمراحل وتقاويم الطاقة وتقديرات العمل وتوزيع التكاليف تلقائيًا")],
 ["",t("Helpdesk: attachments, notifications, customer portal and SLA rules","الدعم: المرفقات والإشعارات وبوابة العميل وقواعد مستوى الخدمة")],
 ["",t("Management: configurable approval policies and broader report preset coverage","الإدارة: سياسات اعتماد قابلة للتهيئة وتوسيع أنواع التقارير المحفوظة")],
 ["",t("Finance/POS: inclusive taxes, external bank feeds and multi-drawer supervision","المالية ونقاط البيع: الضريبة الشاملة والربط البنكي الخارجي والرقابة على الصناديق المتعددة")],
 ["",t("Remaining modules: recurring subscription billing, enterprise document/approval workflows, AI and automation","أقسام متبقية: فوترة الاشتراكات المتكررة ومسارات المستندات والاعتماد المؤسسي والذكاء الاصطناعي والأتمتة")],
 ["",t("Full translation, accessibility, performance and operational acceptance review","مراجعة الترجمة والإتاحة والأداء واعتماد التشغيل بشكل كامل")]]},
 {title:t("Release acceptance evidence still required","أدلة اعتماد الإصدار ما زالت مطلوبة"),description:t("Validate the exact candidate release in an isolated environment. Automated tests do not replace operational acceptance or regulatory review.","يجب فحص الإصدار المرشح نفسه في بيئة معزولة. لا تُغني الفحوص الآلية عن اعتماد التشغيل أو المراجعة النظامية."),items:[
 ["",t("Record migration, unit, database, build and API results for the candidate commit; verify deployment matches it","توثيق نتائج الترحيلات وفحوص الوحدات وقاعدة البيانات والبناء وواجهات البرمجة للإصدار المرشح، والتحقق من تطابق النشر معه")],
 ["",t("Exercise Arabic/English screens, printing, mobile layouts, tenant isolation and immediate permission revocation","اختبار الشاشات العربية والإنجليزية والطباعة وتخطيط الهاتف وعزل المؤسسات وسحب الصلاحيات الفوري")],
 ["",t("Reconcile ledger, VAT, stock and cash scenarios; test retries, interrupted requests and corrections using isolated fixtures only","مطابقة سيناريوهات القيود والضريبة والمخزون والنقد، واختبار إعادة المحاولة وانقطاع الطلبات والتصحيحات ببيانات اختبار معزولة فقط")],
 ["",t("Record business approval, remaining exclusions, restore drill and rollback readiness before live use","توثيق اعتماد المؤسسة والاستثناءات المتبقية وتجربة الاستعادة وجاهزية الرجوع قبل الاستخدام الفعلي")]]},
 {title:t("Services and devices to connect","خدمات وأجهزة تحتاج ربطًا"),description:t("A real provider/account or device is required before these integrations can be completed and tested.","تحتاج هذه التكاملات إلى مزوّد أو حساب فعلي أو جهاز حتى يكتمل ربطها وفحصها."),items:[
 ["",t("Verified email sender/domain for recovery, verification and invitation delivery","مرسل ونطاق بريد موثّقان للاستعادة والتحقق وإرسال الدعوات")],
 ["",t("Fingerprint attendance device and its integration protocol","جهاز البصمة وبروتوكول الربط الخاص به")],
 ["",t("Kitchen printers, payment terminal/provider and bank feeds","طابعات المطبخ وجهاز أو مزوّد الدفع والتغذية البنكية")],
 ["",t("External object storage/delivery and AI provider configuration for their planned modules","تهيئة التخزين والإرسال الخارجي ومزوّد الذكاء الاصطناعي للأقسام المخطط لها")]]},
 {title:t("Operating rules to define and approve","قواعد تشغيل تحتاج تعريفًا واعتمادًا"),description:t("Implementation must follow the business's actual rules and documents; these are not enabled by assumptions.","يلزم أن يتبع التنفيذ قواعد المؤسسة ومستنداتها الفعلية، ولا تُفعّل هذه البنود بافتراضات."),items:[
 ["",t("Leave entitlements, payroll calculations, overtime and overnight attendance","استحقاقات الإجازات وحساب الرواتب والعمل الإضافي والحضور الليلي")],
 ["",t("Inventory costing, recipes, budget approval policies and approval authority","تكلفة المخزون والوصفات وسياسات اعتماد الميزانيات وصلاحيات الاعتماد")],
 ["",t("Statutory tax documents, e-invoicing/filing, imports/reverse charge and final closing","المستندات الضريبية النظامية والفوترة والتقديم الإلكتروني والاستيراد والاحتساب العكسي والإقفال النهائي")],
 ["",t("Backup/restore drills, monitoring, network abuse controls and real acceptance scenarios","تجربة النسخ والاستعادة والمراقبة وحماية الشبكة وسيناريوهات اعتماد التشغيل الفعلي")]]}
 ];
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/dashboard">{t("Dashboard","لوحة التحكم")}</a><a href="/workspace">{t("Workspace","مساحة العمل")}</a></header><section className="hero"><p>{t("DELIVERY STATUS · 11 NOV 2026","حالة التسليم · ١١ نوفمبر ٢٠٢٦")}</p><h1>{t("What is implemented and what remains.","المطوّر والمتبقي في النظام.")}</h1><p>{t("A clear product scope, not a claim that the entire ERP is finished. This is a maintained release checklist, not a live service-health monitor.","نطاق واضح للمنتج، ولا يعني اكتمال نظام ERP بالكامل. هذه قائمة حالة الإصدار وليست شاشة مراقبة فورية للخدمات.")}</p></section>{groups.map(group=><section className="panel" key={group.title}><h2>{group.title}</h2><p>{group.description}</p><ul>{group.items.map(([href,label])=><li key={label}>{href?<a href={href}>{label}</a>:label}</li>)}</ul></section>)}</main>;
}

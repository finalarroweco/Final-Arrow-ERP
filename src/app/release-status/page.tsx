import {redirect} from "next/navigation";
import {currentUser} from "@/lib/auth";
import {getLocale} from "@/lib/server-locale";
import {translate} from "@/lib/locale";
import {LanguageSwitcher} from "../language-switcher";
export default async function ReleaseStatusPage(){
 if(!await currentUser())redirect("/login");const locale=await getLocale(),t=(en:string,ar:string)=>translate(locale,en,ar);
 const groups=[
 {title:t("Implemented workflows","مسارات مطوّرة"),description:t("These modules have scoped application workflows and automated checks. Business acceptance with actual operating rules remains required.","تحتوي هذه الأقسام على مسارات عمل وصلاحيات وفحوص آلية. ما زال اعتمادها مع قواعد العمل الفعلية مطلوبًا."),items:[
 ["/data-import",t("CSV import for customers, suppliers and catalog items with preview and atomic audited batches","استيراد العملاء والموردين والأصناف من CSV بمعاينة ودفعات مدققة تُحفظ كاملة")],
 ["/crm",t("CRM, customers, contacts, quotes and sales orders","إدارة العملاء وجهات الاتصال وعروض الأسعار وطلبات البيع")],
 ["/purchasing/orders",t("Purchases, partial receipts, returns and source settlements","المشتريات والاستلام الجزئي والمرتجعات والتسويات المرتبطة")],
 ["/accounting/ledger",t("Source journals, corrections, period locks and financial reports","قيود المستندات والعكس وإقفال الفترات والتقارير المالية")],
 ["/accounting/customer-aging",t("Customer and supplier balances, statements and posting-date aging","أرصدة وكشوف العملاء والموردين وأعمار الأرصدة من تاريخ القيد")],
 ["/pos",t("POS, saved VAT, full/partial refunds, drawer shifts and cash counting","نقاط البيع والضريبة المحفوظة والاسترداد الكامل والجزئي وورديات الصندوق والعدّ")],
 ["/hr/payroll",t("Employee, attendance, leave and manual payroll workflows","الموظفون والحضور والإجازات ومسارات الرواتب اليدوية")],
 ["/projects",t("Projects, tasks, prerequisite dependencies, assignments, time recording and independent time review","المشاريع والمهام والمتطلبات السابقة والتكليف وتسجيل الوقت واعتماده بصلاحية مستقلة")],
 ["/helpdesk",t("Ticket workflow and permanent internal follow-up","مسار التذاكر وسجل المتابعة الداخلية الدائم")]]},
 {title:t("Remaining product development","تطوير منتج متبقٍ"),description:t("These items require additional implementation and verification; existing module screens do not mean these capabilities are complete.","تحتاج هذه البنود إلى تنفيذ وفحص إضافيين؛ وجود شاشة القسم لا يعني اكتمال هذه الإمكانات."),items:[
 ["",t("Sales: payment terms/due dates, overdue aging and unallocated advances","المبيعات: شروط ومواعيد الاستحقاق وأعمار التأخر والدفعات غير المخصصة")],
 ["",t("Inventory: reservations, valuation and supplier advances","المخزون: الحجوزات والتقييم ودفعات الموردين المقدمة")],
 ["",t("Projects: budgets, billing and resource planning","المشاريع: الميزانيات والفوترة وتخطيط الموارد")],
 ["",t("Helpdesk: attachments, notifications, customer portal and SLA rules","الدعم: المرفقات والإشعارات وبوابة العميل وقواعد مستوى الخدمة")],
 ["",t("Management: configurable approval policies and saved reports","الإدارة: سياسات اعتماد قابلة للتهيئة وتقارير محفوظة")],
 ["",t("Finance/POS: inclusive taxes, bank split matching, frozen certificates and multi-drawer supervision","المالية ونقاط البيع: الضريبة الشاملة وتقسيم مطابقة البنك وشهادات التسوية والرقابة على الصناديق المتعددة")],
 ["",t("Planned modules: subscriptions, documents, AI and automation","أقسام مخطط لها: الاشتراكات والمستندات والذكاء الاصطناعي والأتمتة")],
 ["",t("Full translation, accessibility, performance and operational acceptance review","مراجعة الترجمة والإتاحة والأداء واعتماد التشغيل بشكل كامل")]]},
 {title:t("Services and devices to connect","خدمات وأجهزة تحتاج ربطًا"),description:t("A real provider/account or device is required before these integrations can be completed and tested.","تحتاج هذه التكاملات إلى مزوّد أو حساب فعلي أو جهاز حتى يكتمل ربطها وفحصها."),items:[
 ["",t("Verified email sender/domain for recovery, verification and invitation delivery","مرسل ونطاق بريد موثّقان للاستعادة والتحقق وإرسال الدعوات")],
 ["",t("Fingerprint attendance device and its integration protocol","جهاز البصمة وبروتوكول الربط الخاص به")],
 ["",t("Kitchen printers, payment terminal/provider and bank feeds","طابعات المطبخ وجهاز أو مزوّد الدفع والتغذية البنكية")],
 ["",t("External object storage/delivery and AI provider configuration for their planned modules","تهيئة التخزين والإرسال الخارجي ومزوّد الذكاء الاصطناعي للأقسام المخطط لها")]]},
 {title:t("Operating rules to define and approve","قواعد تشغيل تحتاج تعريفًا واعتمادًا"),description:t("Implementation must follow the business's actual rules and documents; these are not enabled by assumptions.","يلزم أن يتبع التنفيذ قواعد المؤسسة ومستنداتها الفعلية، ولا تُفعّل هذه البنود بافتراضات."),items:[
 ["",t("Leave entitlements, payroll calculations, overtime and overnight attendance","استحقاقات الإجازات وحساب الرواتب والعمل الإضافي والحضور الليلي")],
 ["",t("Inventory costing, recipes, project budgets and approval authority","تكلفة المخزون والوصفات وميزانيات المشاريع وصلاحيات الاعتماد")],
 ["",t("Statutory tax documents, e-invoicing/filing, imports/reverse charge and final closing","المستندات الضريبية النظامية والفوترة والتقديم الإلكتروني والاستيراد والاحتساب العكسي والإقفال النهائي")],
 ["",t("Backup/restore drills, monitoring, network abuse controls and real acceptance scenarios","تجربة النسخ والاستعادة والمراقبة وحماية الشبكة وسيناريوهات اعتماد التشغيل الفعلي")]]}
 ];
 return <main><header><strong>FINAL <span>ARROW</span> ERP</strong><LanguageSwitcher locale={locale}/><a href="/dashboard">{t("Dashboard","لوحة التحكم")}</a><a href="/workspace">{t("Workspace","مساحة العمل")}</a></header><section className="hero"><p>{t("DELIVERY STATUS · 16 OCT 2026","حالة التسليم · ١٦ أكتوبر ٢٠٢٦")}</p><h1>{t("What is implemented and what remains.","المطوّر والمتبقي في النظام.")}</h1><p>{t("A clear product scope, not a claim that the entire ERP is finished. This is a maintained release checklist, not a live service-health monitor.","نطاق واضح للمنتج، ولا يعني اكتمال نظام ERP بالكامل. هذه قائمة حالة الإصدار وليست شاشة مراقبة فورية للخدمات.")}</p></section>{groups.map(group=><section className="panel" key={group.title}><h2>{group.title}</h2><p>{group.description}</p><ul>{group.items.map(([href,label])=><li key={label}>{href?<a href={href}>{label}</a>:label}</li>)}</ul></section>)}</main>;
}

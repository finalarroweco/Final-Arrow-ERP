# Configurable approval workflows / مسارات الموافقة القابلة للإعداد

## Supported operations / العمليات المدعومة

Open **Approvals → Configure policies and review multi-step approvals**. The workspace supports issuing purchase orders, posting expenses, approving leave requests, and optional exact-revision document review. See [document review](DOCUMENT_REVISION_APPROVALS.md) for its distinct non-publishing, editable-source semantics. Payroll retains its existing workflow. It does not send supplier communications, execute payments, create ledger entries, or change stock. The final successful vote performs the existing source status transition in the same database transaction.

افتح **الموافقات ← إعداد السياسات ومراجعة الموافقات متعددة المراحل**. يدعم المسار إصدار أوامر الشراء وترحيل المصاريف واعتماد الإجازات. تبقى الرواتب بمسارها الحالي. لا يرسل المسار رسائل للموردين ولا ينفذ دفعات أو قيود دفتر أستاذ أو تغييرات مخزون. ينفذ التصويت النهائي الناجح انتقال حالة المصدر ضمن المعاملة نفسها.

## Explicit configuration / الإعداد الصريح

Only an organization owner can manage policies. Select an exact company-wide or branch scope. New policies start disabled; enabling them is an explicit operator choice. The migration creates no active policies and enrolls no existing records. With no enabled matching policy, existing source actions remain available.

Each policy has a resource/action, an ordered list of 1–12 stages, a quorum, and named eligible users and/or scoped roles per stage. A user matching either selected list may qualify, but they must also currently hold both the source read permission and its existing action permission at the exact source scope. Policies do not grant system access or infer a management hierarchy. Different role grants are evaluated with their own scopes.

Policies may apply to a single branch or to the company including its branches. Amount thresholds are inclusive and require one explicit currency. Purchase-order thresholds use the subtotal; expense thresholds use the recorded amount before VAT. Amounts in different currencies are never added or converted. Leave policies have no currency or amount thresholds. Overlapping enabled policies cannot silently select competing workflows.

The default requester exclusion also excludes the source creator. Disabling this additional policy restriction cannot override an underlying resource's hard self-approval rule. Set quorums that your eligible, independently authorized users can actually meet; configuration does not promise that those users will remain available or authorized.

تقتصر إدارة السياسات على مالك المؤسسة. اختر نطاق الشركة أو الفرع المحدد. تبدأ السياسات الجديدة معطلة، وتفعيلها قرار صريح من المشغل. لا ينشئ الترحيل سياسات مفعلة ولا يلحق السجلات الحالية تلقائيًا. تبقى الإجراءات الحالية متاحة عندما لا توجد سياسة مفعلة مطابقة.

تحتوي السياسة على إجراء ومراحل مرتبة (1–12) ونصاب ومستخدمين مسمين و/أو أدوار مؤهلة ضمن النطاق لكل مرحلة. يجب أن يملك الموافق حاليًا صلاحية قراءة المصدر وصلاحية الإجراء في نطاق المصدر، إضافةً إلى التأهل للمرحلة. لا تمنح السياسة صلاحيات ولا تفترض تسلسلًا إداريًا.

الحدود المالية شاملة وتتطلب عملة محددة. تستخدم أوامر الشراء المجموع الفرعي والمصاريف المبلغ المسجل قبل الضريبة. لا تُجمع العملات المختلفة ولا تُحوّل. لا توجد حدود مالية للإجازات. يستبعد الإعداد الافتراضي مقدم الطلب ومنشئ المصدر. لا يسمح تعطيله بتجاوز أي منع إلزامي للموافقة الذاتية في المصدر.

## Submit, decide and revise / التقديم والقرار والمراجعة

Use **Approval workflow / current state** on the actual purchase-order, expense or leave row, or enter the exact source ID in the workspace. The preview is bound to current source content and the policy version. Review it before submitting. A pending approval pins that snapshot and policy revision. Editing the source or changing its status is blocked while the request is pending. Calling the legacy issue/post/approve endpoint does not bypass a configured policy.

Each stage counts distinct approving users. Prior decisions remain in history. Before finalizing, the workflow rechecks current source authorization and eligibility of all prior approving users. Suspended membership, revoked access or changed scoped roles can therefore block finalization. Refresh, cancel the request if authorized, and resubmit under a workable policy rather than treating historical votes as current authority.

A rejection terminates the workflow request without rejecting/voiding the underlying source. Cancellation also leaves source status unchanged. The requester or owner may cancel only with current source rights. Cancellation requires a reason. Following rejection or cancellation, inspect the source again and submit a new request. Old requests and decisions remain retained.

Saving a policy revision, including pausing it, does not rewrite past approvals. Pending requests using an older policy cannot continue voting; cancel and resubmit against a fresh preview. A disabled policy does not make an existing pending request disappear. Already approved sources are not retroactively undone by policy edits.

استخدم رابط المسار في صف المصدر الفعلي أو أدخل معرف المصدر المحدد. ترتبط المعاينة بمحتوى المصدر وإصدار السياسة الحاليين. يثبت الطلب المعلق هذه اللقطة، ويمنع تعديل المصدر أو تغيير حالته حتى إلغاء الطلب. لا تتجاوز واجهات الإجراءات القديمة السياسة المفعلة.

يحسب كل نصاب مستخدمين مختلفين، وتبقى القرارات السابقة في السجل. يُعاد التحقق من صلاحيات وتأهل جميع الموافقين السابقين قبل الإنهاء. قد يؤدي تعليق العضوية أو سحب الصلاحية أو تغيير الدور إلى منع الإنهاء.

ينهي الرفض أو الإلغاء طلب المسار دون تغيير حالة المصدر نفسه. يمكن لمقدم الطلب أو المالك إلغاء الطلب مع وجود صلاحيات المصدر الحالية وذكر السبب. أعد معاينة المصدر قبل تقديم طلب بديل. لا يغير تعديل السياسة القرارات السابقة؛ تتطلب الطلبات المعلقة على إصدار أقدم الإلغاء وإعادة التقديم.

## Recovery and privacy / الاستعادة والخصوصية

The browser saves an exact pending command, bound to actor and scope, before sending. It requires persistent local storage and browser locks. Do not clear browser storage to work around an uncertain outcome. **Retry exact request** sends the same ID and content. **Resolve / abandon uncommitted request** either retrieves the already committed receipt or permanently fences the uncommitted command. Only then prepare a new command. Changing account or scope cannot adopt another account's pending command. Cross-tab storage changes require an explicit retry of the newly displayed saved request.

Saved commands may include policy details or a decision reason. They are stored in the current browser without application-level encryption. Use a trusted device and its normal account/device protections. An unverified response does not clear the saved command. If a stored command cannot be decoded or storage/locking is unavailable, the UI blocks new commands rather than silently discarding it.

Source snapshots, private decision reasons and history require current source read/action access. Owner policy access alone does not reveal HR requests. On observed authentication loss, private views are cleared. Inbox, decisions and policy-version history are paginated; each **Next page** retrieves another authorized page. No screen claims that one page is a complete export. Exact-source links preserve tenant, company, branch, resource and source ID. Purchase orders also link to their existing document page.

يحفظ المتصفح الأمر المحدد قبل إرساله مع ربطه بالحساب والنطاق. لا تمسح التخزين لتجاوز نتيجة غير مؤكدة. تعيد المحاولة إرسال الأمر نفسه؛ ويعيد الحسم إيصال التنفيذ أو يمنع الأمر غير المنفذ نهائيًا. لا يمكن لحساب أو نطاق آخر تبني الأمر المحفوظ.

قد يتضمن التخزين المحلي تفاصيل السياسة أو سبب القرار، وهو دون تشفير على مستوى التطبيق؛ استخدم جهازًا موثوقًا. لا تمسح الاستجابة غير الموثقة الطلب المحفوظ. تتطلب اللقطات والأسباب والسجلات صلاحيات المصدر الحالية. إدارة السياسات وحدها لا تكشف طلبات الموارد البشرية. القوائم والسجلات مقسمة إلى صفحات ولا تُقدَّم الصفحة الواحدة على أنها تصدير كامل.

## Verification boundary

Automated checks cover input validation, API/database invariants, rendered AR/EN content, strict receipt identity, browser persistence and lock failures, cross-tab collision handling, mounted read epochs, and delayed authentication failures as documented in the release evidence. This document is not a claim of interactive browser acceptance, deployment, or production policy activation.

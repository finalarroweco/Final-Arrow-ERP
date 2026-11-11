# Exact-revision internal review / مراجعة إصدار مستند محدد

Internal text review is optional. In **Approvals → Configure policies**, an Owner can create a disabled **Approve document revision** policy, select named users and/or scoped roles, set 1–12 stages and their quorums, then explicitly enable it. No policies or requests are created by migration. Documents have no currency or monetary thresholds; API and SQL reject these predicates.

مراجعة المستند النصي اختيارية. ينشئ المالك سياسة «اعتماد إصدار مستند» معطلة أولًا، ويحدد المستخدمين أو الأدوار ضمن النطاق والمراحل والنصاب، ثم يفعلها صراحةً. لا ينشئ الترحيل سياسات أو طلبات. لا توجد عملة أو حدود مالية للمستندات.

## What approval means

The source ID is an immutable **revision event UUID**, never the mutable document ID. Open the document, select its exact revision, and choose **Review this exact immutable revision**. The preview pins the whole plain-text snapshot and policy version. The fingerprint identifies this canonical snapshot; it is not a digital signature. Approval records an internal review of that revision only. It does not publish, share, sign, attach, send, lock editing, or change the document text, version, status or timestamp. No finalization permit is needed because no source transition is performed.

معرّف المصدر هو معرّف حدث إصدار ثابت، وليس معرّف المستند المتغير. اختر الإصدار من سجل المستند وافتح مراجعته. تثبت المعاينة النص الكامل وإصدار السياسة. الموافقة مراجعة داخلية لذلك الإصدار فقط، وليست نشرًا أو مشاركة أو توقيعًا، ولا تغير النص أو حالته.

Only the currently active revision can be submitted or voted on. Editing, archiving and restoring remain available through existing document permissions and each creates a new immutable revision. Old pending requests remain retained but cannot be approved or rejected; requester or Owner with current source rights may cancel them. The new current revision requires its own explicit submission. An approved revision cannot be submitted again. Historical approved revisions remain approved historically and are labelled **superseded**, never as approval of current text. Archive/restore never revives eligibility of an earlier revision, even if its text is identical.

يمكن تقديم الإصدار الحالي النشط والتصويت عليه فقط. يبقى التعديل والأرشفة والاستعادة متاحًا، وكل إجراء ينشئ إصدارًا جديدًا. تبقى الطلبات القديمة محفوظة لكنها لا تقبل التصويت؛ يستطيع مقدم الطلب أو المالك إلغاءها بصلاحيات المصدر الحالية. يتطلب الإصدار الجديد تقديمًا منفصلًا. لا يمكن إعادة تقديم إصدار معتمد. لا تعني موافقة إصدار سابق اعتماد النص الحالي، ولا تعيد الاستعادة أهلية إصدار قديم.

## Access and recovery

New `document:approve` permission is assigned only to existing and newly registered Owners by default. Managers/Viewers receive none automatically. An authorized role manager may grant it explicitly. Review actions and private workflow snapshots/history require **both** current scoped `document:read` and `document:approve`, plus stage eligibility for voting. Owner policy authority alone never reveals document text or private review reasons. Default requester exclusion also excludes the document's original creator and the selected revision's author. Turning that optional exclusion off explicitly permits their vote if all other requirements are met.

Ordinary readers retain their existing document/history/download/print rights. These views expose only safe exact-revision status, not reviewer identities, reasons or policy details. UTF-8 downloads preserve the exact title/body format and report review/current status in `X-Document-Revision-Review` and `X-Document-Revision-Current` response headers. Print shows selected version and whether it is current or superseded.

صلاحية المراجعة الجديدة للمالك فقط افتراضيًا. تتطلب المراجعة قراءة المستند وصلاحية اعتماده ضمن النطاق الحالي، مع أهلية المرحلة. لا تكشف إدارة السياسات وحدها النص أو أسباب القرار. يستبعد الإعداد الافتراضي مقدم الطلب ومنشئ المستند وكاتب الإصدار. يحتفظ القراء بحقوق القراءة والتنزيل والطباعة، ويرون حالة الإصدار دون تفاصيل القرارات الخاصة.

Existing approval recovery applies unchanged: persist exact actor/scope-bound commands, retry the same UUID or resolve/abandon it permanently before making a replacement. Current session is checked inside the same transaction after waits, including committed replays; expired/deleted sessions fail without committing a new vote. Current membership/permissions/role eligibility are rechecked and prior voters are revalidated at finalization. Policy changes pause old pending requests until cancellation/resubmission. Private audit events contain IDs only, never text or review reasons.

## Integrity and verification boundary

Review and text editing serialize on the tenant lock then the document advisory/row lock. A race can approve a revision immediately before a new edit, or the edit wins and the old review fails; approval never transfers to the new version. The immutable event and a retained foreign-key binding preserve source identity. Decisions, bindings and audit history reject ordinary mutation/deletion/truncation. No retention period or deletion policy is inferred. Database owners who deliberately disable guards are outside this protection boundary.

Tests cover SQL/API policy validation, named/scoped access, prior-voter revocation, creator exclusion, exact receipts, archive/restore/edit races, rollback, session loss after waits, safe status, real registration defaults, AR/EN rendered controls and existing recovery. Full execution evidence is reported separately. Interactive browser accessibility/RTL appearance and physical printing still require manual acceptance. No live provider migration, external communication, deployment or signatures are included.

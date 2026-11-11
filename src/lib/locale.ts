export type Locale = "ar" | "en";
export function translate(locale: Locale, english: string, arabic: string) {
  return locale === "ar" ? arabic : english;
}

/** Stable public categories. Never classify or translate arbitrary server/user text. */
export type ApiErrorCode = 'UNAUTHENTICATED' | 'FORBIDDEN' | 'INVALID_INPUT' | 'NOT_FOUND' | 'CONFLICT' | 'ACTOR_MISMATCH' | 'RESULT_LIMIT' | 'ACTOR_REQUIRED' | 'PAYLOAD_TOO_LARGE' | 'UNSUPPORTED_MEDIA_TYPE' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'UNKNOWN';
export function apiErrorCode(status: number): ApiErrorCode {
  if (status === 401) return 'UNAUTHENTICATED';
  if (status === 403) return 'FORBIDDEN';
  if (status === 404) return 'NOT_FOUND';
  if (status === 409 || status === 412) return 'CONFLICT';
  if (status === 413) return 'PAYLOAD_TOO_LARGE';
  if (status === 415) return 'UNSUPPORTED_MEDIA_TYPE';
  if (status === 429) return 'RATE_LIMITED';
  if (status === 400 || status === 422) return 'INVALID_INPUT';
  if (status === 502 || status === 503 || status === 504) return 'UNAVAILABLE';
  return 'UNKNOWN';
}
const apiMessages: Record<ApiErrorCode, readonly [string, string]> = {
  UNAUTHENTICATED: ['Sign in again before continuing. Check any pending request before submitting another.', 'سجّل الدخول مجدداً قبل المتابعة. تحقق من أي طلب معلّق قبل إرسال طلب آخر.'],
  FORBIDDEN: ['Access is not allowed in this scope. Check your company, branch and permissions.', 'الوصول غير مسموح في هذا النطاق. تحقق من الشركة والفرع والصلاحيات.'],
  INVALID_INPUT: ['Check the required fields, values and selected scope, then try again.', 'تحقق من الحقول المطلوبة والقيم والنطاق المختار، ثم حاول مجدداً.'],
  NOT_FOUND: ['The requested record is unavailable in this scope. Refresh the list and check access.', 'السجل المطلوب غير متاح في هذا النطاق. حدّث القائمة وتحقق من صلاحية الوصول.'],
  CONFLICT: ['The request conflicts with the current state. Refresh and review before retrying. For a pending request, use its exact retry or check-and-abandon controls; do not submit a duplicate.', 'يتعارض الطلب مع الحالة الحالية. حدّث البيانات وراجعها قبل المحاولة. للطلب المعلّق، استخدم إعادة محاولة الطلب نفسه أو التحقق والإلغاء؛ لا ترسل طلباً مكرراً.'],
  ACTOR_MISMATCH: ['Sign in with the original account to recover this pending request. Do not submit it as another user.', 'سجّل الدخول بالحساب الأصلي لاستعادة الطلب المعلّق. لا ترسله باسم مستخدم آخر.'],
  ACTOR_REQUIRED: ['The original account is required to recover this pending request. Sign in with that account before retrying.', 'الحساب الأصلي مطلوب لاستعادة هذا الطلب المعلّق. سجّل الدخول بذلك الحساب قبل إعادة المحاولة.'],
  RESULT_LIMIT: ['The result exceeds the supported record limit. Narrow the date range, branch or other filters.', 'تتجاوز النتائج الحد المسموح للسجلات. ضيّق الفترة أو الفرع أو الفلاتر الأخرى.'],
  PAYLOAD_TOO_LARGE: ['The request is too large. Reduce its size before submitting.', 'حجم الطلب أكبر من المسموح. قلّل حجمه قبل الإرسال.'],
  UNSUPPORTED_MEDIA_TYPE: ['The request format is unsupported. Reload the page before trying again.', 'صيغة الطلب غير مدعومة. أعد تحميل الصفحة قبل المحاولة.'],
  RATE_LIMITED: ['Too many requests. Wait before trying again; do not duplicate pending requests.', 'عدد الطلبات كبير. انتظر قبل المحاولة؛ لا تكرر الطلبات المعلّقة.'],
  UNAVAILABLE: ['The service could not confirm the outcome. Check saved records and any pending request before retrying; do not create a duplicate.', 'تعذر على الخدمة تأكيد النتيجة. تحقق من السجلات المحفوظة وأي طلب معلّق قبل المحاولة؛ لا تنشئ نسخة مكررة.'],
  UNKNOWN: ['The outcome could not be verified. Check saved records and any pending request before retrying; do not create a duplicate.', 'تعذر التحقق من النتيجة. تحقق من السجلات المحفوظة وأي طلب معلّق قبل المحاولة؛ لا تنشئ نسخة مكررة.'],
};
/** Presentation only: never changes retry state, request payloads or authorization. */
export function presentApiError(t: (english: string, arabic: string) => string, payload: unknown, status = 0): string {
  let code: unknown;
  if (payload && typeof payload === 'object') {
    const body = payload as {code?: unknown; error?: unknown};
    code = body.code;
    if (!code && body.error && typeof body.error === 'object') code = (body.error as {code?: unknown}).code;
  }
  // HTTP auth boundaries take precedence over a malformed or stale payload code.
  const category = status === 401 || status === 403 ? apiErrorCode(status)
    : typeof code === 'string' && Object.hasOwn(apiMessages, code) ? code as ApiErrorCode : apiErrorCode(status);
  return t(...apiMessages[category]);
}

/** Only errors created from our own localized copy may reach the UI verbatim. */
export class LocalizedPresentationError extends Error {}
export function presentCaughtError(t: (english: string, arabic: string) => string, error: unknown) {
  return error instanceof LocalizedPresentationError ? error.message : presentApiError(t, null);
}

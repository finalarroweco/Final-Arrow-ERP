import type { z } from 'zod';
import type { rfqDetailResponse, rfqListResponse, rfqOffersResponse } from '@/lib/supplier-rfq-input';
export type RfqScopeOption = { tenantId: string; companyId: string; branchId: string | null; label: string; canManage: boolean; canAward: boolean };
export type RfqDetail = z.infer<typeof rfqDetailResponse>;
export type RfqRow = z.infer<typeof rfqListResponse>['rfqs'][number];
export type RfqOffers = z.infer<typeof rfqOffersResponse>;
export type RfqReadEpoch = { current: number };

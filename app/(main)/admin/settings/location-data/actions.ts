'use server';

import { revalidatePath } from 'next/cache';
import db from '@/lib/db';
import { getActiveContactsAccess } from '@/lib/contacts/active-location-access';
import { performResetAnalytics, type ResetAnalyticsResult } from '@/lib/analytics/reset';

export async function resetAnalytics(
  _previousState: ResetAnalyticsResult,
  formData: FormData,
): Promise<ResetAnalyticsResult> {
  try {
    const result = await performResetAnalytics({
      confirmation: String(formData.get('confirmation') || ''),
      getAccess: () => getActiveContactsAccess(),
      database: db,
    });

    if (result.success) {
      revalidatePath('/admin/analytics');
      revalidatePath('/admin/settings/location-data');
    }
    return result;
  } catch (error) {
    console.error('[RESET_ANALYTICS] Reset failed', error);
    return { success: false, message: 'Analytics could not be reset. No partial deletion was committed.', deletedCounts: null };
  }
}

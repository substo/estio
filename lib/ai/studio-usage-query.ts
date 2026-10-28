import { Prisma } from '@prisma/client';
import { usagePeriodStarts } from './usage-periods';
export function studioUsageQuery(resolvedLocationId: string, now = new Date()) {
    const { startOfToday, endOfToday, startOfMonth, endOfMonth } = usagePeriodStarts(now);
    return Prisma.sql`
            select operation, provider, coalesce(model, 'unknown') model,
              count(*) calls, coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)),0)::bigint tokens,
              coalesce(sum(cost_micros),0)::float8 / 1000000 cost,
              count(*) filter(where settled_at >= ${startOfToday} and settled_at < ${endOfToday}) today_calls,
              coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)) filter(where settled_at >= ${startOfToday} and settled_at < ${endOfToday}),0)::bigint today_tokens,
              coalesce(sum(cost_micros) filter(where settled_at >= ${startOfToday} and settled_at < ${endOfToday}),0)::float8 / 1000000 today_cost,
              count(*) filter(where settled_at >= ${startOfMonth} and settled_at < ${endOfMonth}) month_calls,
              coalesce(sum(coalesce(input_tokens,0)+coalesce(output_tokens,0)) filter(where settled_at >= ${startOfMonth} and settled_at < ${endOfMonth}),0)::bigint month_tokens,
              coalesce(sum(cost_micros) filter(where settled_at >= ${startOfMonth} and settled_at < ${endOfMonth}),0)::float8 / 1000000 month_cost
            from studio.studio_ai_usage where location_id = ${resolvedLocationId} and status = 'settled'
            group by operation, provider, model`;
}

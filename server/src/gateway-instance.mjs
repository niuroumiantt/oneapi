// The gateway process serving employee calls, and the release of calls a stopped process left open
// (docs/14-gateway-settings.md C4, D6). Before this, a deploy restart left its open calls 'pending' for 20 minutes:
// they kept the caller's concurrency slots and holds although nothing was running them any more.
import { randomUUID } from 'node:crypto';
import { hostname } from 'node:os';

/** This process. Every employee call it opens records this id. */
export const GATEWAY_INSTANCE=randomUUID();
/** seen_at is written this often. A process that misses it for GONE_AFTER is treated as stopped. */
export const HEARTBEAT_MS=10000;
// Longer than the 20 seconds a stopping process may keep serving (index.mjs), so its last calls finish or die first.
export const GONE_AFTER='30 seconds';

/** Registers this process on first use, then keeps it marked as running. */
export const heartbeat=(pool,id=GATEWAY_INSTANCE)=>pool.query('INSERT INTO gateway_instances(id,host) VALUES($1,$2) ON CONFLICT (id) DO UPDATE SET seen_at=now()',[id,hostname().slice(0,120)]);
/** A clean shutdown: the next process releases this one's calls without waiting for GONE_AFTER. */
export const markStopped=(pool,id=GATEWAY_INSTANCE)=>pool.query('UPDATE gateway_instances SET stopped_at=now() WHERE id=$1 AND stopped_at IS NULL',[id]);

/**
 * Releases calls left open by gateway processes that are no longer running. Safe to repeat; never touches `self`.
 *  - No KerAPI request ID (the upstream had not answered): failed as GATEWAY_INTERRUPTED, nothing charged, hold released.
 *  - Request ID recorded (the answer was streaming when the process stopped): awaiting KerAPI's log as GATEWAY_INTERRUPTED,
 *    priced like a hang-up (D4); free if KerAPI charged nothing or never logs it (H7 excludes these calls).
 * Calls without a gateway_instance were opened before this mechanism existed and stay on the 20-minute rule.
 */
export async function releaseInterruptedCalls(pool,self=GATEWAY_INSTANCE){
 const r=(await pool.query(`WITH gone AS (
   UPDATE employee_calls c SET status=CASE WHEN c.upstream_request_id IS NULL THEN 'failed' ELSE 'awaiting_bill' END,error_code='GATEWAY_INTERRUPTED',finished_at=now()
   WHERE c.status='pending' AND c.gateway_instance IS NOT NULL AND c.gateway_instance<>$1
    AND NOT EXISTS(SELECT 1 FROM gateway_instances g WHERE g.id=c.gateway_instance AND g.stopped_at IS NULL AND g.seen_at>now()-interval '${GONE_AFTER}')
   RETURNING c.owner_id,c.hold_yuan,c.upstream_request_id)
  SELECT count(*)::int AS released,count(upstream_request_id)::int AS awaiting_bill,count(DISTINCT owner_id)::int AS people,
   coalesce(sum(hold_yuan) FILTER(WHERE upstream_request_id IS NULL),0)::text AS freed_yuan FROM gone`,[self])).rows[0];
 // Old process rows are only a restart history; keep a month of it.
 await pool.query("DELETE FROM gateway_instances WHERE coalesce(stopped_at,seen_at)<now()-interval '30 days' AND id<>$1",[self]);
 return r;
}

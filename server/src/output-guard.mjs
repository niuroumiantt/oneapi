// Refuse known unsafe output limits before sending billable requests. Stream truncation cannot bound supplier cost.
export const IGNORES_MAX_TOKENS = 'ignores_max_tokens';
// Cost quarantine is authoritative on every request. Never fail open or rely on stale process-local flags.
export async function guardedModels(pool) {
 return new Set((await pool.query("SELECT model_id FROM upstream_model_flags WHERE flag=$1 AND cleared_at IS NULL", [IGNORES_MAX_TOKENS])).rows.map(r=>r.model_id));
}
export function forgetGuardCache() {} // Compatibility with flag writers; no cached authorization.
export const COST_BLOCK_MESSAGE = '上游不遵守输出 Token 上限，已暂停调用以避免额外费用；待供应商修复并验证后恢复';
export function costBlockedResponse(){return new Response(JSON.stringify({error:{code:'UPSTREAM_OUTPUT_LIMIT_UNSAFE',message:COST_BLOCK_MESSAGE}}),{status:503,headers:{'content-type':'application/json','x-semifly-cost-blocked':'1'}});}
export function costSafeFetch(pool,fetchImpl){return async(url,init)=>{
 if(String(url).split('?')[0].endsWith('/chat/completions'))return routeFetch(pool,fetchImpl,JSON.parse(init.body).model,url,init);
 return fetchImpl(url,init);
};}

// Disconnecting a stream cannot guarantee cancellation of upstream generation or billing.
// A known unsafe model must be rejected before any billable request is sent.
export async function routeFetch(pool, fetchImpl, upstreamModel, url, init) {
 if ((await guardedModels(pool)).has(upstreamModel)) return costBlockedResponse();
 return fetchImpl(url, init);
}

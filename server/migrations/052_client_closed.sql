-- Gateway decision 2026-11-12 (docs/14-gateway-settings.md D4): calls the caller hung up on are CLIENT_CLOSED, not upstream
-- failures; calls settled from KerAPI's log are priced from its token counts at the official rate (supplier_tokens) or are
-- free when KerAPI charged nothing (supplier_free).
ALTER TABLE employee_calls DROP CONSTRAINT IF EXISTS employee_calls_settlement_source_check;
ALTER TABLE employee_calls ADD CONSTRAINT employee_calls_settlement_source_check CHECK(settlement_source IN ('supplier_log','hold_fallback','official_price','supplier_tokens','supplier_free'));
-- Before this change an aborted fetch could only come from the caller disconnecting (timeouts were recorded as UPSTREAM_TIMEOUT).
UPDATE employee_calls SET error_code='CLIENT_CLOSED' WHERE error_code='UPSTREAM_FAILED' AND error_detail='This operation was aborted';

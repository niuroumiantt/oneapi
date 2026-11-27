import { createHash } from 'node:crypto';
import { HttpError } from './core.mjs';
import { OFFICIAL_MODELS } from './official-models.mjs';

export const MODEL_COMMISSION_BPS = 1000;
export const MODEL_COMMISSION_BASIS = 'consumed_cash_v1';

const catalog = new Map(OFFICIAL_MODELS.map(({ id, name }) => [id, name]));
export const modelPackName = id => catalog.get(id) || id;

export async function modelPackOffers(db, models) {
 const { rows } = await db.query(
  'SELECT model_id,min_price_bps FROM model_pack_offers WHERE enabled AND model_id=ANY($1::text[]) ORDER BY model_id',
  [models.filter(id => catalog.has(id))],
 );
 return rows.map(row => ({ ...row, name: modelPackName(row.model_id), commission_bps: MODEL_COMMISSION_BPS }));
}

export async function modelPackOffer(db, modelId, models, price) {
 if (!catalog.has(modelId) || !models.includes(modelId)) throw new HttpError(409, '该模型暂未开放专属充值');
 const offer = (await db.query(
  'SELECT * FROM model_pack_offers WHERE model_id=$1 AND enabled FOR SHARE',
  [modelId],
 )).rows[0];
 if (!offer) throw new HttpError(409, '该模型的专属优惠已暂停');
 if (!Number.isSafeInteger(price) || price < offer.min_price_bps || price > 10000)
  throw new HttpError(409, '客户折扣低于该模型当前允许的最低价，或超过原价');
 if (price * (10000 - MODEL_COMMISSION_BPS) < offer.cost_bps * 10000)
  throw new HttpError(409, '该模型售价不足以覆盖采购成本与提成，请联系平台调整报价');
 return offer;
}

export async function quoteModelPack(db, code, account, cash, models) {
 if (account.organization_id) throw new HttpError(400, '此模型促销码仅适用于个人账户');
 if (!Number.isSafeInteger(cash) || cash < 500 || cash > 5000000)
  throw new HttpError(400, '请填写 ¥5 至 ¥50,000 的实付金额');
 const offer = await modelPackOffer(db, code.model_id, models, code.model_price_bps);
 const face = Math.floor(cash * 10000 / code.model_price_bps);
 if (face > 5000000) throw new HttpError(400, '到账额度超过 ¥50,000，请减少实付金额');
 const model = {
  id: code.model_id,
  name: modelPackName(code.model_id),
  offer_id: offer.id,
  price_bps: code.model_price_bps,
  cost_bps: offer.cost_bps,
  commission_basis: MODEL_COMMISSION_BASIS,
  commission_bps: MODEL_COMMISSION_BPS,
 };
 const confirmation = createHash('sha256').update(JSON.stringify([code.id, model, cash])).digest('hex');
 return {
  face_fen: face, amount_fen: cash,
  discount_snapshot: {
   percent: code.model_price_bps / 100,
   promo_code: code.code, requested_cash_fen: cash,
   model_pack: model, model_pack_confirmation: confirmation,
   cw: { code_id: code.id, partner_id: code.partner_id, is_self_code: false, rate_bps: MODEL_COMMISSION_BPS, basis: MODEL_COMMISSION_BASIS },
  },
 };
}

// Reserve matching packs before shared credit. Other models reserve only their own
// packs and the shared credit they still need. Hold the account lock for allocation.
export async function availableForModel(db, accountId, modelId, excludeCallId = null) {
 return (await db.query(`WITH balances AS (
   SELECT model_id,sum(remaining_fen) AS fen FROM credit_packs
   WHERE account_id=$1 AND remaining_fen>0 AND refund_id IS NULL GROUP BY model_id
  ), holds AS (
   SELECT model_id,sum(hold_yuan)*100 AS fen FROM customer_calls
   WHERE account_id=$1 AND ($3::uuid IS NULL OR id<>$3) AND status IN ('pending','awaiting_bill')
   GROUP BY model_id
  )
  SELECT greatest(0, coalesce((SELECT sum(fen) FROM balances WHERE model_id IS NULL OR model_id=$2),0)
   - coalesce((SELECT sum(CASE WHEN h.model_id=$2 THEN h.fen ELSE greatest(0,h.fen-coalesce(b.fen,0)) END)
     FROM holds h LEFT JOIN balances b ON b.model_id=h.model_id),0))::text AS fen`,
 [accountId, modelId, excludeCallId])).rows[0].fen;
}

// Procurement estimates and legacy settlement prices are internal, never checkout data.
export function publicDiscount(snapshot) {
 if (!snapshot?.model_pack) return snapshot;
 const {cost_bps,settlement_bps,...model}=snapshot.model_pack;
 return {...snapshot,model_pack:model};
}

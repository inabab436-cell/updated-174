/**
 * ORDER REGISTRATION CLAIM GUARD (first order).
 *
 * Sibling of `order-addition-claim-guard`, for the case that guard deliberately
 * skips: a conversation with NO registered order yet.
 *
 * The observed failure: the model writes the final summary AND then behaves as
 * if the order exists — "كده الأوردر بتاعك مؤكد", the totals, the payment
 * method with its wallet number, "هتبلغيني لما التحويل يتم" — without ever
 * calling `create_order`. Nothing is written, the merchant sees no order, no
 * notification is raised, no manual-payment stop happens, and the agent keeps
 * chatting while the customer believes they have an order.
 *
 * Two truths this enforces:
 *  1. Registering the order is the ONLY order operation the agent performs; a
 *     sentence is never a registration.
 *  2. A manual payment method never delays the registration. The order is
 *     registered first, then the payment instructions are sent; the payment is
 *     confirmed later by the store team.
 *
 * Pure helpers — no I/O, fully testable.
 */

export interface OrderClaimCheckInput {
  /** The conversation already carries at least one registered order. */
  hasExistingOrder: boolean;
  /** `create_order` succeeded during THIS turn. */
  orderRegisteredThisTurn: boolean;
  /** `create_order` ran and returned a failure — the reply must explain, not re-register. */
  orderSaveFailed: boolean;
  /** How many corrections were already issued in this turn. */
  correctionsIssued: number;
  /** The reply the model wants to send. */
  reply: string;
}

/** Only judge when an unregistered FIRST-order claim is actually possible. */
export function shouldJudgeOrderClaim(input: OrderClaimCheckInput): boolean {
  if (input.hasExistingOrder) return false; // the addition guard owns that case
  if (input.orderRegisteredThisTurn) return false;
  if (input.orderSaveFailed) return false; // the tool already spoke; don't loop
  if (input.correctionsIssued >= 1) return false;
  return Boolean(input.reply && input.reply.trim().length > 0);
}

/**
 * Judgement prompt: meaning only, one word out.
 *
 * The legitimate final summary — every detail plus a go-ahead question — must
 * read as NO. Anything that treats the order as existing, done, confirmed,
 * reserved, or as something whose money is now due, is YES.
 */
export function buildOrderClaimJudgeMessages(
  reply: string,
  customerText: string,
): Array<{ role: "system" | "user"; content: string }> {
  return [
    {
      role: "system",
      content:
        "You judge one reply written by a store representative to a customer who has NO registered order yet. " +
        "Answer YES when the reply, in any wording or dialect, presents the order as existing or settled: it is " +
        "registered, recorded, confirmed, reserved, booked, done, on its way, being prepared, will be shipped, " +
        "or the reply asks the customer to transfer/pay the amount now, or says the representative is waiting for " +
        "the transfer or for a payment screenshot, or promises to confirm the order once the money arrives. " +
        "Answer NO when the reply only collects information, discusses products or prices, lists the payment " +
        "methods to choose from, or states the full order summary and asks the customer to go ahead — i.e. it " +
        "asks for approval and promises nothing. Answer with exactly YES or NO.",
    },
    {
      role: "user",
      content: `Customer said: ${customerText}\n\nRepresentative reply: ${reply}`,
    },
  ];
}

/** Reads the judge's answer; anything unclear is treated as "no claim". */
export function parseOrderClaimVerdict(raw: string | null | undefined): boolean {
  return /^\s*yes\b/i.test(String(raw ?? ""));
}

/**
 * Correction pushed back into the model context. It does not write the reply —
 * it forces the registration path so the real order and payment flow run.
 */
export const ORDER_CLAIM_CORRECTION =
  "SYSTEM CORRECTION — NO ORDER EXISTS. Your draft reply treats the order as registered, confirmed, reserved or " +
  "payable, but you never called create_order, so nothing was saved: the store sees no order, no order number " +
  "exists, no notification was raised and no payment step was started. THERE IS NO SUCH THING AS 'الأوردر مؤكد' " +
  "coming from you — the only order operation you perform is REGISTERING it with create_order. A manual payment " +
  "method NEVER delays that: you register the order FIRST, then send the payment instructions the tool returns; " +
  "the store team confirms the payment later. Never wait for a transfer, a screenshot or any customer signal " +
  "before registering. Call create_order NOW with the data this customer already gave and the payment method they " +
  "chose, then write your reply ONLY from the tool result (the order number it returns plus the payment " +
  "instructions). If a required field is genuinely missing, ask for that one field alone and promise nothing.";

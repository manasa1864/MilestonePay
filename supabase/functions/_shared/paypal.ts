/**
 * Minimal PayPal REST client (Orders v2, Payments v2, Payouts v1) using fetch only.
 * Sandbox base URL by default; set PAYPAL_API_BASE to https://api-m.paypal.com for live.
 */

export type PayPalConfig = { clientId: string; secret: string; baseUrl?: string; fetchImpl?: typeof fetch };

export class PayPalError extends Error {
  constructor(message: string, readonly status: number, readonly issue: string | null, readonly retryable: boolean) {
    super(message);
  }
}

const SANDBOX = "https://api-m.sandbox.paypal.com";

export const toValue = (cents: number) => (cents / 100).toFixed(2);
export const toCents = (value: string) => Math.round(Number(value) * 100);

export class PayPalClient {
  private token: { value: string; expires: number } | null = null;
  private base: string;
  private doFetch: typeof fetch;

  constructor(private cfg: PayPalConfig) {
    this.base = (cfg.baseUrl || SANDBOX).replace(/\/+$/, "");
    this.doFetch = cfg.fetchImpl ?? fetch;
  }

  private async accessToken(): Promise<string> {
    if (this.token && this.token.expires > Date.now() + 60_000) return this.token.value;
    const res = await this.doFetch(`${this.base}/v1/oauth2/token`, {
      method: "POST",
      headers: { Authorization: `Basic ${btoa(`${this.cfg.clientId}:${this.cfg.secret}`)}`, "Content-Type": "application/x-www-form-urlencoded" },
      body: "grant_type=client_credentials",
    });
    if (!res.ok) throw new PayPalError("PayPal rejected the app credentials. Check PAYPAL_CLIENT_ID and PAYPAL_SECRET.", res.status, null, false);
    const data = await res.json();
    this.token = { value: data.access_token, expires: Date.now() + Number(data.expires_in ?? 300) * 1000 };
    return this.token.value;
  }

  private async call<T>(method: string, path: string, body?: unknown, requestId?: string): Promise<T> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${await this.accessToken()}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    };
    if (requestId) headers["PayPal-Request-Id"] = requestId;
    let res: Response;
    try {
      res = await this.doFetch(`${this.base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch (e) {
      throw new PayPalError(`Could not reach PayPal: ${e instanceof Error ? e.message : String(e)}`, 0, null, true);
    }
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    const data = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const issue: string | null = data?.details?.[0]?.issue ?? data?.name ?? null;
      const description: string = data?.details?.[0]?.description ?? data?.message ?? `PayPal returned ${res.status}`;
      throw new PayPalError(`${description}${issue ? ` (${issue})` : ""}`, res.status, issue, res.status >= 500 || res.status === 429);
    }
    return data as T;
  }

  /** Create an order that will be authorized (not captured) for the full project budget. */
  async createAuthorizeOrder(p: { projectId: string; title: string; cents: number; currency: string }) {
    const order = await this.call<{ id: string; status: string }>("POST", "/v2/checkout/orders", {
      intent: "AUTHORIZE",
      purchase_units: [{
        reference_id: p.projectId,
        custom_id: p.projectId,
        description: `MilestonePay: ${p.title}`.slice(0, 127),
        amount: { currency_code: p.currency, value: toValue(p.cents) },
      }],
      payment_source: { paypal: { experience_context: { brand_name: "MilestonePay", user_action: "CONTINUE", shipping_preference: "NO_SHIPPING" } } },
    });
    return order.id;
  }

  /** Authorize an approved order. Returns the authorization id, amount and expiry. */
  async authorizeOrder(orderId: string) {
    type Auth = { id: string; status: string; amount: { value: string; currency_code: string }; expiration_time?: string };
    const data = await this.call<{ status: string; purchase_units: { custom_id?: string; payments?: { authorizations?: Auth[] } }[] }>(
      "POST", `/v2/checkout/orders/${encodeURIComponent(orderId)}/authorize`, {}, `authorize-${orderId}`,
    );
    const auth = data.purchase_units?.[0]?.payments?.authorizations?.[0];
    if (!auth) throw new PayPalError("PayPal did not return an authorization.", 502, null, false);
    if (!["CREATED", "PENDING"].includes(auth.status)) throw new PayPalError(`PayPal authorization status is ${auth.status}.`, 402, auth.status, false);
    return {
      authorizationId: auth.id,
      cents: toCents(auth.amount.value),
      currency: auth.amount.currency_code,
      expiresAt: auth.expiration_time ?? new Date(Date.now() + 29 * 86400_000).toISOString(),
      customId: data.purchase_units?.[0]?.custom_id ?? null,
    };
  }

  /** Capture part of an authorization. requestId makes retries return the original capture. */
  async capture(p: { authorizationId: string; cents: number; currency: string; finalCapture: boolean; invoiceId: string; note: string; requestId: string }) {
    const data = await this.call<{ id: string; status: string }>("POST", `/v2/payments/authorizations/${encodeURIComponent(p.authorizationId)}/capture`, {
      amount: { currency_code: p.currency, value: toValue(p.cents) },
      final_capture: p.finalCapture,
      invoice_id: p.invoiceId.slice(0, 127),
      note_to_payer: p.note.slice(0, 255),
    }, p.requestId);
    if (!["COMPLETED", "PENDING"].includes(data.status)) throw new PayPalError(`PayPal capture status is ${data.status}.`, 402, data.status, false);
    return { captureId: data.id, status: data.status };
  }

  /** Void whatever is left on an authorization (used when a funded project is cancelled). */
  async void(authorizationId: string) {
    await this.call<void>("POST", `/v2/payments/authorizations/${encodeURIComponent(authorizationId)}/void`, undefined, `void-${authorizationId}`);
  }

  /** Send money from the platform's sandbox business account to the freelancer's PayPal email. */
  async payout(p: { batchId: string; email: string; cents: number; currency: string; note: string; subject: string }) {
    const data = await this.call<{ batch_header: { payout_batch_id: string; batch_status: string } }>("POST", "/v1/payments/payouts", {
      sender_batch_header: { sender_batch_id: p.batchId.slice(0, 127), email_subject: p.subject.slice(0, 255), email_message: p.note.slice(0, 1000) },
      items: [{ recipient_type: "EMAIL", receiver: p.email, amount: { value: toValue(p.cents), currency: p.currency }, note: p.note.slice(0, 4000), sender_item_id: p.batchId.slice(0, 63) }],
    });
    return { batchId: data.batch_header.payout_batch_id, status: data.batch_header.batch_status };
  }
}

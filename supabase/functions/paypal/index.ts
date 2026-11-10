// PayPal Sandbox payments for MilestonePay.
// Secrets: PAYPAL_CLIENT_ID, PAYPAL_SECRET (optional PAYPAL_API_BASE for live).
// Actions: create_order, authorize_order, capture_release, retry_payout, cancel_project.
import { paypalActions } from "../_shared/actions.ts";
import { PayPalClient } from "../_shared/paypal.ts";
import { serve } from "../_shared/serve.ts";

const clientId = Deno.env.get("PAYPAL_CLIENT_ID");
const secret = Deno.env.get("PAYPAL_SECRET");
const paypal = clientId && secret ? new PayPalClient({ clientId, secret, baseUrl: Deno.env.get("PAYPAL_API_BASE") }) : undefined;

serve(paypalActions, () => ({ paypal }));

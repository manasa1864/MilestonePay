// Loads the PayPal JS SDK once (public client id only; the secret stays on the server).

type ButtonsOptions = {
  style?: Record<string, unknown>;
  createOrder: () => Promise<string>;
  onApprove: (data: { orderID: string }) => Promise<void>;
  onCancel?: () => void;
  onError?: (err: unknown) => void;
};
type PayPalNamespace = { Buttons: (o: ButtonsOptions) => { render: (el: HTMLElement) => Promise<void>; close?: () => Promise<void> } };

declare global {
  interface Window { paypal?: PayPalNamespace }
}

let loading: Promise<PayPalNamespace> | null = null;

export function loadPayPal(clientId: string, currency: string): Promise<PayPalNamespace> {
  if (window.paypal) return Promise.resolve(window.paypal);
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=authorize&components=buttons`;
    s.async = true;
    s.onload = () => (window.paypal ? resolve(window.paypal) : reject(new Error("PayPal did not load.")));
    s.onerror = () => { loading = null; reject(new Error("Could not load PayPal. Check VITE_PAYPAL_CLIENT_ID and your connection.")); };
    document.head.appendChild(s);
  });
  return loading;
}

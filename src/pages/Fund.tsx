import { useEffect, useRef, useState } from "react";
import { act, useApp } from "../app-context";
import { backend } from "../lib/backend";
import { date, errorText, initials, money as fmt, pad } from "../lib/format";
import { loadPayPal } from "../lib/paypalSdk";
import { milestonesOf, personName } from "../lib/select";
import { Button, Empty, Icon, Notice, PageHeader, Spinner } from "../ui";

function PayPalButtons({ projectId, onDone }: { projectId: string; onDone: () => void }) {
  const ctx = useApp();
  const { settings } = ctx;
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"loading" | "ready" | "working" | "error">("loading");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadPayPal(settings.paypalClientId, settings.currency)
      .then((paypal) => {
        if (cancelled || !ref.current) return;
        ref.current.innerHTML = "";
        return paypal.Buttons({
          style: { layout: "vertical", color: "gold", shape: "rect", label: "paypal", height: 42 },
          createOrder: async () => {
            setError("");
            try { return await backend.paypalCreateOrder(projectId); }
            catch (e) { setError(errorText(e)); throw e; }
          },
          onApprove: async ({ orderID }) => {
            setState("working");
            const ok = await act(ctx, () => backend.paypalAuthorize(projectId, orderID), "PayPal authorization confirmed. The freelancer can start milestone 01.");
            if (ok) onDone(); else setState("ready");
          },
          onCancel: () => setError("PayPal checkout was closed before approving. Nothing was authorized."),
          onError: (e) => setError(errorText(e) || "PayPal reported an error."),
        }).render(ref.current).then(() => !cancelled && setState("ready"));
      })
      .catch((e) => { if (!cancelled) { setError(errorText(e)); setState("error"); } });
    return () => { cancelled = true; };
  }, [projectId, settings.paypalClientId, settings.currency]); // eslint-disable-line react-hooks/exhaustive-deps

  return <div className="paypal-box">
    {state === "loading" && <div className="loading-row light"><Spinner/> Loading PayPal…</div>}
    {state === "working" && <div className="loading-row light"><Spinner/> Confirming authorization…</div>}
    <div ref={ref} className={state === "working" ? "hidden" : ""}/>
    {error && <p className="checkout-error">{error}</p>}
    <small className="centered">Log in with a <b>PayPal Sandbox personal</b> account. The full budget is authorized, not charged.</small>
  </div>;
}

export function Fund({ projectId }: { projectId: string }) {
  const ctx = useApp();
  const { ws, go, settings } = ctx;
  const [loading, setLoading] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const p = ws.projects.find((x) => x.id === projectId);
  if (!p) return <Empty title="Project not found" action={<Button onClick={() => go("/projects")}>All projects</Button>}/>;
  const ms = milestonesOf(ws, p.id);
  const funded = p.status !== "draft";
  const lastDue = ms.map((m) => m.dueDate).filter(Boolean).sort().at(-1) ?? null;
  const tooLong = settings.paypalEnabled && lastDue && Date.parse(lastDue) > Date.now() + 29 * 86_400_000;

  async function authorize() {
    setLoading(true);
    const r = await act(ctx, () => backend.authorizeProject(projectId), "Funding authorized. The freelancer can start milestone 01.");
    setLoading(false);
    if (r) setReference(r);
  }

  return <div className="fund-layout"><div><PageHeader eyebrow={funded ? "Project funding" : "Step 3 of 3"} title="Authorize project funding" subtitle={settings.paypalEnabled ? "Review the allocation, then authorize the budget with PayPal Sandbox." : "Review the allocation before authorizing (simulated payments)."}/>
    <section className="fund-card"><div className="project-identity"><div className="project-monogram">{initials(p.title)}</div><div><span>PROJECT</span><h2>{p.title}</h2><p>With {personName(ws, p.freelancerId)}</p></div></div><div className="allocation-list">{ms.map((m) => <div key={m.id}><span>{pad(m.position)}</span><p>{m.title}{m.dueDate && <small className="due-inline"> · due {date(m.dueDate)}</small>}</p><small>{m.percent}%</small><b className="mono">{fmt(m.amountCents)}</b></div>)}</div>
      <div className="policy-line"><span>Late penalty</span><b>{p.latePenaltyPerDay > 0 && p.latePenaltyCap > 0 ? `${p.latePenaltyPerDay}% per day late, max ${p.latePenaltyCap}%` : "None"}</b></div></section>
    {tooLong && <Notice tone="warn"><b>The last due date is more than 29 days away.</b> PayPal authorizations expire after 29 days; approvals after that will fail. <button className="text-link inline" onClick={() => go(`/project/${p.id}/edit`)}>Edit the plan</button></Notice>}
    <div className="legal-note"><Icon name="alert" size={18}/><p><b>Authorization, not escrow</b><br/>The full project amount is authorized{settings.paypalEnabled ? " on your PayPal account" : ""}. Each approved milestone captures only what passed verification (minus any late penalty){settings.paypalEnabled ? " and is paid out to the freelancer’s PayPal" : ""}. Whatever isn’t captured is released when the project ends.</p></div>
  </div><aside className="checkout"><span className="sandbox-label">{settings.paypalEnabled ? "PAYPAL SANDBOX" : "SIMULATED"}</span><h2>Authorization summary</h2><div className="checkout-row"><span>Project amount</span><b className="mono">{fmt(p.budgetCents)}</b></div><div className="checkout-row"><span>Fees</span><b className="mono">$0.00</b></div><div className="checkout-total"><span>Total to authorize</span><strong className="mono">{fmt(p.budgetCents)}</strong></div>
    {!funded
      ? <>{settings.paypalEnabled
          ? <PayPalButtons projectId={p.id} onDone={() => go(`/project/${p.id}`)}/>
          : <><button className="paypal-btn" onClick={authorize} disabled={loading}>{loading ? <Spinner/> : "Authorize (simulated)"}</button><small className="centered">Simulated authorization. Turn on PayPal in Supabase to use the real sandbox.</small></>}
        <div className="fund-links"><button className="text-link light" onClick={() => go(`/project/${p.id}/edit`)}>Edit plan</button><button className="text-link light" onClick={() => go(`/project/${p.id}`)}>Fund later</button></div></>
      : <div className="authorization-success"><span><Icon name="check" size={20}/></span><h3>Authorization confirmed</h3><p>{p.paymentMode === "paypal" ? "PayPal" : "Simulated"} authorization <b>{reference ?? p.authorizationRef}</b> is active{p.authorizationExpiresAt ? ` until ${date(p.authorizationExpiresAt)}` : ""}. No funds have been captured.</p><Button onClick={() => go(`/project/${p.id}`)}>Open project <Icon name="arrow" size={16}/></Button></div>}
  </aside></div>;
}

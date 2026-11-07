import { useState } from "react";
import { act, useApp } from "../app-context";
import { backend } from "../lib/backend";
import { initials, money as fmt, pad } from "../lib/format";
import { milestonesOf, personName } from "../lib/select";
import { Button, Empty, Icon, PageHeader, Spinner } from "../ui";

export function Fund({ projectId }: { projectId: string }) {
  const ctx = useApp();
  const { ws, go } = ctx;
  const [loading, setLoading] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const p = ws.projects.find((x) => x.id === projectId);
  if (!p) return <Empty title="Project not found" action={<Button onClick={() => go("/projects")}>All projects</Button>}/>;
  const ms = milestonesOf(ws, p.id);
  const funded = p.status !== "draft";

  async function authorize() {
    setLoading(true);
    const r = await act(ctx, () => backend.authorizeProject(projectId), "Funding authorized. The freelancer can start milestone 01.");
    setLoading(false);
    if (r) setReference(r);
  }

  return <div className="fund-layout"><div><PageHeader eyebrow="New project · Step 3 of 3" title="Authorize project funding" subtitle="Review the allocation before continuing to PayPal Sandbox."/>
    <section className="fund-card"><div className="project-identity"><div className="project-monogram">{initials(p.title)}</div><div><span>PROJECT</span><h2>{p.title}</h2><p>With {personName(ws, p.freelancerId)}</p></div></div><div className="allocation-list">{ms.map((m) => <div key={m.id}><span>{pad(m.position)}</span><p>{m.title}</p><small>{m.percent}%</small><b className="mono">{fmt(m.amountCents)}</b></div>)}</div></section>
    <div className="legal-note"><Icon name="alert" size={18}/><p><b>Authorization, not escrow</b><br/>The full project amount is authorized through PayPal Sandbox. Funds are captured in parts only after you explicitly approve a milestone release, and anything not captured is released when the project ends. MilestonePay does not hold funds.</p></div>
  </div><aside className="checkout"><span className="sandbox-label">PAYPAL SANDBOX</span><h2>Authorization summary</h2><div className="checkout-row"><span>Project amount</span><b className="mono">{fmt(p.budgetCents)}</b></div><div className="checkout-row"><span>Fees</span><b className="mono">$0.00</b></div><div className="checkout-total"><span>Total to authorize</span><strong className="mono">{fmt(p.budgetCents)}</strong></div>
    {!funded ? <><button className="paypal-btn" onClick={authorize} disabled={loading}>{loading ? <Spinner/> : "Continue with PayPal"}</button><small className="centered">Simulated authorization. No real funds will move.</small><button className="text-link light" onClick={() => go(`/project/${p.id}`)}>Fund later</button></>
      : <div className="authorization-success"><span><Icon name="check" size={20}/></span><h3>Authorization confirmed</h3><p>Sandbox authorization <b>{reference ?? p.authorizationRef}</b> is active. No funds have been captured.</p><Button onClick={() => go(`/project/${p.id}`)}>Open project <Icon name="arrow" size={16}/></Button></div>}
  </aside></div>;
}

import { useApp } from "../app-context";
import { date, money as fmt, pad } from "../lib/format";
import { money } from "../lib/select";
import { Empty, PageHeader, StatusBadge } from "../ui";

function CaptureChart({ points }: { points: { t: number; v: number }[] }) {
  if (points.length === 0) return <Empty title="No captures yet">Captured milestone payments will chart here.</Empty>;
  const W = 900, H = 180, pad_ = 12;
  const t0 = points[0].t, t1 = Math.max(points[points.length - 1].t, t0 + 86400000);
  const max = Math.max(...points.map((p) => p.v), 1);
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (v: number) => H - pad_ - (v / max) * (H - pad_ * 2);
  const series = [{ t: t0, v: 0 }, ...points];
  let d = `M${x(series[0].t)} ${y(0)}`;
  for (let i = 1; i < series.length; i++) d += ` L${x(series[i].t)} ${y(series[i - 1].v)} L${x(series[i].t)} ${y(series[i].v)}`;
  d += ` L${W} ${y(series[series.length - 1].v)}`;
  const labels = [t0, t0 + (t1 - t0) / 2, t1].map((t) => new Date(t).toLocaleDateString("en-US", { month: "short", day: "2-digit" }));
  return <div className="line-chart"><div className="grid-lines"><i/><i/><i/><i/></div><svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Cumulative captured payments"><path d={`${d} L${W} ${H} L0 ${H}Z`} fill="url(#fade)"/><path d={d} fill="none" stroke="currentColor" strokeWidth="2.2" vectorEffect="non-scaling-stroke"/><defs><linearGradient id="fade" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="currentColor" stopOpacity=".14"/><stop offset="1" stopColor="currentColor" stopOpacity="0"/></linearGradient></defs></svg><div className="chart-labels">{labels.map((l, i) => <span key={i}>{l}</span>)}</div></div>;
}

export function Payments() {
  const { ws, user, go } = useApp();
  const client = user.role === "client";
  const t = money(ws);
  const captures = ws.payments.filter((p) => p.kind === "capture").sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  let run = 0;
  const points = captures.map((c) => ({ t: new Date(c.createdAt).getTime(), v: (run += c.amountCents) }));
  const paidOut = ws.payments.filter((p) => p.kind === "payout").reduce((a, p) => a + p.amountCents, 0);
  const anyPayPal = ws.projects.some((p) => p.paymentMode === "paypal");
  const metrics: [string, string, string][] = client
    ? [["Total authorized", fmt(t.authorized), "Across all funded projects"], ["Total captured", fmt(t.captured), `${captures.length} capture${captures.length === 1 ? "" : "s"}`], ["Remaining authorization", fmt(t.remaining), t.released ? `${fmt(t.released)} released back` : "Available for capture"]]
    : [["Captured earnings", fmt(t.captured), `${captures.length} milestone payment${captures.length === 1 ? "" : "s"}`], anyPayPal ? ["Paid out to PayPal", fmt(paidOut), paidOut < t.captured ? `${fmt(t.captured - paidOut)} not paid out yet` : "Everything captured has been paid out"] : ["Still authorized", fmt(t.remaining), "Available as you complete milestones"], ["Average per milestone", fmt(captures.length ? Math.round(t.captured / captures.length) : 0), "Across captured milestones"]];
  const label = { authorization: "Authorized", capture: "Captured", release: "Released", payout: "Paid out" } as const;
  const tone = { authorization: "active", capture: "complete", release: "pending", payout: "complete" } as const;

  return <><PageHeader title={client ? "Payments" : "Earnings"} subtitle={client ? "Authorization and capture activity across your projects." : "Payments captured for your approved milestones."} action={<span className="sandbox-pill">{anyPayPal ? "PAYPAL SANDBOX" : "SIMULATED"}</span>}/>
    <section className="metrics">{metrics.map(([l, v, n]) => <div className="metric" key={l}><span>{l}</span><strong>{v}</strong><small>{n}</small></div>)}</section>
    <section className="chart-panel"><div className="section-heading"><div><h2>{client ? "Captured payment activity" : "Earnings over time"}</h2><p>Cumulative captures</p></div><strong className="mono">{fmt(t.captured)}</strong></div><CaptureChart points={points}/></section>
    <section className="section-block"><div className="section-heading"><div><h2>Payment history</h2><p>All authorization, capture and release events</p></div></div>
      {ws.payments.length === 0 ? <Empty title="No payment activity yet">{client ? "Authorize a project to see it here." : "Payments appear once a client funds a project with you."}</Empty>
        : <div className="table-wrap"><table><thead><tr><th>Date</th><th>Project</th><th>Milestone</th><th>Amount</th><th>Type</th><th>Reference</th></tr></thead><tbody>{ws.payments.map((p) => {
          const pr = ws.projects.find((x) => x.id === p.projectId);
          const m = ws.milestones.find((x) => x.id === p.milestoneId);
          return <tr key={p.id} className="clickable" onClick={() => go(`/project/${p.projectId}`)}><td>{date(p.createdAt)}</td><td className="strong">{pr?.title ?? "—"}</td><td>{m ? `Milestone ${pad(m.position)}` : "—"}</td><td className="mono">{fmt(p.amountCents)}</td><td><StatusBadge tone={tone[p.kind]}>{label[p.kind]}</StatusBadge></td><td className="mono muted-text">{p.reference}{p.note && (p.kind === "capture" || p.kind === "payout") ? <small className="ref-note">{p.note}</small> : null}</td></tr>;
        })}</tbody></table></div>}
    </section>
  </>;
}

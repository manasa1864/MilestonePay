import { useId, useMemo, useRef, useState, type FocusEvent, type PointerEvent } from "react";
import { date, money as fmt } from "../lib/format";

/**
 * Milestone chart: one row per milestone (or per project).
 *   Budget column - bar length = amount on a shared scale. In "progress" mode the bar is split
 *                   into what has been captured and what is still to pay (2px gap between them).
 *   Schedule      - a bar from when the milestone starts to its due date, with a "today" line.
 * One hue (the app's green) in two validated steps; status is written as text, never as color.
 * Every value is in a tooltip (hover and keyboard focus) and in the "View as table" twin.
 */
export type ChartRow = {
  key: string;
  label: string;
  /** Short text under the label, e.g. "Approved" or "Due in 3 days". */
  sub?: string;
  amountCents: number;
  capturedCents?: number;
  /** YYYY-MM-DD */
  start?: string | null;
  /** YYYY-MM-DD */
  due?: string | null;
  done?: boolean;
  overdue?: boolean;
};

type Props = {
  rows: ChartRow[];
  mode: "plan" | "progress";
  /** Name of the amount column. */
  amountLabel?: string;
  showSchedule?: boolean;
  /** Names for the two steps in progress mode. */
  legend?: [done: string, todo: string];
  /** Accessible summary of the whole chart. */
  label: string;
  today?: string;
};

const DAY = 86_400_000;
/** Local midnight for a YYYY-MM-DD date (never via UTC, so the day can't shift by time zone). */
const parse = (d: string) => Date.parse(`${d}T00:00:00`);
const localDay = (t: number) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const todayStr = () => localDay(Date.now());
/** Axis label; adds the year when the range spans years or isn't this year. */
const tick = (t: number, withYear: boolean) =>
  new Date(t).toLocaleDateString("en-US", withYear ? { month: "short", day: "numeric", year: "numeric" } : { month: "short", day: "numeric" });

export function MilestoneChart({ rows, mode, amountLabel = "Budget", showSchedule = true, legend = ["Captured", "Still to pay"], label, today = todayStr() }: Props) {
  const tableId = useId();
  const wrap = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ i: number; x: number; y: number } | null>(null);
  const total = rows.reduce((a, r) => a + Math.max(0, r.amountCents), 0);
  const max = Math.max(1, ...rows.map((r) => r.amountCents));
  const progress = mode === "progress";

  // Shared time scale for the schedule column.
  const scale = useMemo(() => {
    const points = rows.flatMap((r) => [r.start, r.due]).filter((d): d is string => !!d && !Number.isNaN(parse(d)));
    if (!points.length) return null;
    const lo = Math.min(...points.map(parse), parse(today));
    const hi = Math.max(...points.map(parse), parse(today) + DAY);
    const span = Math.max(DAY, hi - lo);
    return { lo, hi, x: (d: string) => ((parse(d) - lo) / span) * 100 };
  }, [rows, today]);
  const schedule = showSchedule && !!scale;

  function place(i: number, e: PointerEvent<HTMLElement> | FocusEvent<HTMLElement>) {
    const box = wrap.current?.getBoundingClientRect();
    if (!box) return;
    const target = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = "clientX" in e ? e.clientX : target.left + target.width / 2;
    setTip({ i, x: Math.min(Math.max(px - box.left, 120), box.width - 120), y: target.top - box.top });
  }

  if (!rows.length) return null;
  const hovered = tip ? rows[tip.i] : null;

  return <div className="mc" ref={wrap} onPointerLeave={() => setTip(null)}>
    {(progress || schedule) && <div className="mc-legend" aria-hidden="true">
      {progress ? <><span><i className="mc-key done"/>{legend[0]}</span><span><i className="mc-key todo"/>{legend[1]}</span></> : <span><i className="mc-key done"/>{amountLabel}</span>}
      {schedule && <span><i className="mc-key line"/>Today</span>}
    </div>}

    <div className={`mc-grid ${schedule ? "with-schedule" : ""}`} role="img" aria-label={label} aria-describedby={tableId}>
      <div className="mc-head" aria-hidden="true">
        <span/>
        <span>{amountLabel}</span>
        {schedule && scale && (() => {
          const years = new Date(scale.lo).getFullYear() !== new Date(scale.hi).getFullYear() || new Date(scale.lo).getFullYear() !== new Date().getFullYear();
          return <span className="mc-axis"><em>{tick(scale.lo, years)}</em><em>{tick(scale.hi, years)}</em></span>;
        })()}
      </div>
      {rows.map((r, i) => {
        const w = (Math.max(0, r.amountCents) / max) * 100;
        const cap = Math.min(r.capturedCents ?? 0, r.amountCents);
        const capW = r.amountCents > 0 ? (cap / r.amountCents) * 100 : 0;
        const share = total ? Math.round((r.amountCents / total) * 100) : 0;
        const start = r.start ?? r.due ?? null;
        const s = scale && start ? scale.x(start) : null;
        const e = scale && r.due ? scale.x(r.due) : null;
        return <div
          key={r.key}
          className={`mc-row ${tip?.i === i ? "hover" : ""}`}
          tabIndex={0}
          aria-label={`${r.label}: ${fmt(r.amountCents)}${progress ? `, ${fmt(cap)} ${legend[0].toLowerCase()}` : `, ${share}% of the total`}${r.due ? `, due ${date(r.due)}` : ""}${r.overdue ? ", overdue" : ""}${r.sub ? `, ${r.sub}` : ""}`}
          onFocus={(ev) => place(i, ev)}
          onBlur={() => setTip(null)}
        >
          <div className="mc-name"><b>{r.label}</b>{(r.sub || r.overdue) && <small>{[r.sub, r.overdue ? "Overdue" : ""].filter(Boolean).join(" · ")}</small>}</div>
          <div className="mc-budget" onPointerMove={(ev) => place(i, ev)}>
            <div className="mc-track" style={{ width: `calc((100% - 104px) * ${w / 100})` }}>
              {progress
                ? <>{capW > 0 && <span className="mc-bar done" style={{ width: capW >= 100 ? "100%" : `calc(${capW}% - 1px)` }}/>}{capW < 100 && <span className={`mc-bar todo ${capW > 0 ? "after" : ""}`} style={{ width: capW > 0 ? `calc(${100 - capW}% - 1px)` : "100%" }}/>}</>
                : <span className="mc-bar done" style={{ width: "100%" }}/>}
            </div>
            <span className="mc-value">{progress ? <>{fmt(cap)}<em> / {fmt(r.amountCents)}</em></> : <>{fmt(r.amountCents)}<em> · {share}%</em></>}</span>
          </div>
          {schedule && <div className="mc-schedule" onPointerMove={(ev) => place(i, ev)}>
            {scale && <span className="mc-today" style={{ left: `${scale.x(today)}%` }}/>}
            {e !== null && s !== null
              // Due before it could start (e.g. a past date): show a short mark at the due date, never a reversed bar.
              ? <span className={`mc-span ${progress && !r.done ? "todo" : "done"}`} style={e >= s ? { left: `${s}%`, width: `max(6px, ${e - s}%)` } : { left: `${e}%`, width: "6px" }}/>
              : <span className="mc-nodate">No due date</span>}
          </div>}
        </div>;
      })}
      {hovered && tip && <div className="mc-tip" role="tooltip" style={{ left: tip.x, top: tip.y }}>
        <b>{hovered.label}</b>
        {progress
          ? <><div><strong>{fmt(Math.min(hovered.capturedCents ?? 0, hovered.amountCents))}</strong> {legend[0].toLowerCase()}</div><div><strong>{fmt(Math.max(0, hovered.amountCents - (hovered.capturedCents ?? 0)))}</strong> {legend[1].toLowerCase()}</div></>
          : <div><strong>{fmt(hovered.amountCents)}</strong> · {total ? Math.round((hovered.amountCents / total) * 100) : 0}% of the total</div>}
        {hovered.due && <div>Due <strong>{date(hovered.due)}</strong>{hovered.overdue ? " · overdue" : ""}</div>}
        {hovered.sub && <div className="muted">{hovered.sub}</div>}
      </div>}
    </div>

    <details className="mc-table">
      <summary>View as table</summary>
      <table id={tableId}>
        <thead><tr><th>Name</th><th>{amountLabel}</th>{progress ? <th>{legend[0]}</th> : <th>Share</th>}{showSchedule && <th>Starts</th>}{showSchedule && <th>Due</th>}<th>Status</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}>
          <td>{r.label}</td>
          <td className="mono">{fmt(r.amountCents)}</td>
          {progress ? <td className="mono">{fmt(Math.min(r.capturedCents ?? 0, r.amountCents))}</td> : <td>{total ? Math.round((r.amountCents / total) * 100) : 0}%</td>}
          {showSchedule && <td>{r.start ? date(r.start) : "—"}</td>}
          {showSchedule && <td>{r.due ? date(r.due) : "—"}</td>}
          <td>{[r.sub, r.overdue ? "Overdue" : ""].filter(Boolean).join(" · ") || "—"}</td>
        </tr>)}</tbody>
      </table>
    </details>
  </div>;
}

import { cloneElement, isValidElement, useEffect, useId, useRef, useState } from "react";
import type { ComponentProps, CSSProperties, ReactElement, ReactNode } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { deltaArrow, deltaTone, formatPercent, type DeltaMetric } from "./lib/format";
import { capUsage } from "./lib/capUsage";
import { fmtUsd } from "./api";

export function PageHead({ title, sub, actions }: { title: string; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{title}</h1>
        {sub ? <p className="page-sub">{sub}</p> : null}
      </div>
      {actions ? <div className="head-actions">{actions}</div> : null}
    </div>
  );
}

export function Panel({ id, title, note, actions, children, flush, className }: { id?: string; title?: ReactNode; note?: ReactNode; actions?: ReactNode; children: ReactNode; flush?: boolean; className?: string }) {
  return (
    <section id={id} className={`panel mb-4${className ? ` ${className}` : ""}`} >
      {title || note || actions ? <div className="panel-head">
        <div className="panel-title">{title ? <><span className="sig" />{title}</> : null}</div>
        {actions ?? (note ? <span className="panel-note">{note}</span> : null)}
      </div> : null}
      {flush ? children : <div className="panel-body">{children}</div>}
    </section>
  );
}

export function Modal({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent aria-describedby={undefined}>
        <DialogTitle>{title}</DialogTitle>
        {children}
      </DialogContent>
    </Dialog>
  );
}

// A field wraps exactly one control in the common case, so the label can point
// at it. When it wraps a group (a card, a row of controls), the wrapper becomes
// a labelled group instead of pretending to own a single input.
export function Field({ label, children }: { label: string; children: ReactNode }) {
  const id = useId();
  const single = isValidElement(children) && [Input, Textarea, InlineSelect].includes(children.type as never);
  const control = single
    ? cloneElement(children as ReactElement<{ id?: string; "aria-label"?: string }>, {
        id: (children.props as { id?: string }).id ?? id,
        "aria-label": (children.props as { "aria-label"?: string })["aria-label"] ?? label,
      })
    : children;
  return (
    <div className="grid gap-1.5" role={single ? undefined : "group"} aria-labelledby={single ? undefined : `${id}-label`}>
      <Label htmlFor={single ? id : undefined} id={`${id}-label`}>{label}</Label>
      {control}
    </div>
  );
}

export function ErrorText({ children }: { children: ReactNode }) {
  return <p className="field-error">{children}</p>;
}

export function Notice({ children }: { children: ReactNode }) {
  return <p className="field-hint">{children}</p>;
}

// Radix Select forbids "" as an item value; map it to a sentinel so inline
// (non-RHF) selects can keep an empty "none"/"all" option.
const EMPTY_SELECT = "__empty__";

export function InlineSelect({ value, onValueChange, options, disabled, className, placeholder, id, ...rest }: {
  value: string;
  onValueChange: (value: string) => void;
  options: Array<{ value: string; label: string }>;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  id?: string;
} & Omit<ComponentProps<typeof SelectTrigger>, "id" | "className">) {
  return (
    <Select value={value === "" ? EMPTY_SELECT : value} onValueChange={(next) => onValueChange(next === EMPTY_SELECT ? "" : next)} disabled={disabled}>
      <SelectTrigger id={id} className={className} {...rest}><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        {options.map((option) => <SelectItem key={option.value || EMPTY_SELECT} value={option.value === "" ? EMPTY_SELECT : option.value}>{option.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

/** Period-over-period chip driven by the console-wide delta policy. */
export function Trend({ current, previous, metric = "runs", suffix = "" }: { current: number; previous: number | null | undefined; metric?: DeltaMetric; suffix?: string }) {
  if (previous == null || !Number.isFinite(previous) || previous === 0 || !Number.isFinite(current)) return null;
  const pct = ((current - previous) / previous) * 100;
  const direction = pct >= 0.05 ? 1 : pct <= -0.05 ? -1 : 0;
  if (!direction) return <span className="trend neutral">flat{suffix}</span>;
  return <span className={`trend ${deltaTone(metric, direction)}`}>{deltaArrow(direction)} {formatPercent(Math.abs(pct))}{suffix}</span>;
}

export function TableLoading() {
  return <div className="panel-body"><span className="skeleton" style={{ display: "block", width: "100%", height: 60 }} /></div>;
}

/** Table skeleton rows keep the panel shape while the first page loads. */
export function SkeletonRows({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return <>{Array.from({ length: rows }, (_, row) => (
    <tr key={row} className="skeleton-row" aria-hidden="true">
      {Array.from({ length: columns }, (_, column) => (
        <td key={column}><span className="skeleton skeleton-cell" style={{ width: column === 0 ? "68%" : column % 2 ? "52%" : "38%" }} /></td>
      ))}
    </tr>
  ))}</>;
}

/** Six-line prose clamp with an explicit expand control; no inner scroller. */
export function ClampedText({ text, quote = false, testId }: { text: string; quote?: boolean; testId?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [canExpand, setCanExpand] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    setExpanded(false);
  }, [text]);
  useEffect(() => {
    const element = ref.current;
    if (!element || expanded) return;
    const measure = () => setCanExpand(element.scrollHeight > element.clientHeight + 1);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [text, expanded]);
  return <div className={`clamped-text${quote ? " is-quote" : ""}`} data-test={testId}>
    <p ref={ref} className={`clamp-prose${expanded ? " is-open" : ""}`}>{text}</p>
    {canExpand || expanded ? (
      <button type="button" className="clamp-toggle" aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        {expanded ? "Show less" : "Show more"}
      </button>
    ) : null}
  </div>;
}

/** A real sparkline: 1.5px stroke, baseline, last-point dot, no fill. */
export function Sparkline({ values, accent = false, bars = false, width = 160, height = 28 }: { values: number[]; accent?: boolean; bars?: boolean; width?: number; height?: number }) {
  const series = values.filter((value) => Number.isFinite(value)).slice(-30);
  if (!series.length) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  if (bars) {
    // Discrete daily values (and zero-heavy series) read better as bars than a
    // line that flattens to the baseline.
    const count = series.length;
    const gap = count > 20 ? 1 : 2;
    const barWidth = Math.max(1, (width - gap * (count - 1)) / count);
    return <svg className={`sparkline${accent ? " is-accent" : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
      <line x1="0" y1={height - 1} x2={width} y2={height - 1} className="sparkline-base" />
      {series.map((value, index) => {
        const barHeight = max > 0 ? Math.max(0, (value / max) * (height - 6)) : 0;
        if (barHeight <= 0) {
          return <rect key={index} x={(index * (barWidth + gap)).toFixed(2)} y={height - 2} width={barWidth.toFixed(2)} height={1} className="sparkline-bar is-zero" />;
        }
        return <rect
          key={index}
          x={(index * (barWidth + gap)).toFixed(2)}
          y={(height - 2 - barHeight).toFixed(2)}
          width={barWidth.toFixed(2)}
          height={barHeight.toFixed(2)}
          rx={barWidth > 3 ? 1 : 0}
          className={`sparkline-bar${index === count - 1 ? " is-last" : ""}`}
        />;
      })}
    </svg>;
  }
  const span = max - min || 1;
  const step = series.length > 1 ? (width - 4) / (series.length - 1) : 0;
  const point = (value: number, index: number) => {
    const x = series.length === 1 ? width / 2 : 2 + index * step;
    const y = height - 4 - ((value - min) / span) * (height - 8);
    return [x, y] as const;
  };
  const points = series.map(point);
  const path = points.map(([x, y], index) => `${index === 0 ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const [lastX, lastY] = points[points.length - 1];
  return <svg className={`sparkline${accent ? " is-accent" : ""}`} viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" y1={height - 1} x2={width} y2={height - 1} className="sparkline-base" />
    <path d={path} className="sparkline-path" vectorEffect="non-scaling-stroke" />
    <circle cx={lastX} cy={lastY} r="2.2" className="sparkline-dot" />
  </svg>;
}

/**
 * Month-to-date spend against a hard cap. The bar is paired with an icon and
 * a text label at 80% and 100%, so the state does not rely on colour alone.
 */
export function CapUsage({ spend, cap, budget }: { spend: number; cap: number | null | undefined; budget?: number | null }) {
  const usage = capUsage(spend, cap);
  if (!usage) {
    return <div className="cap-usage">
      <div className="cap-line"><b>{fmtUsd(spend)}</b><span className="cap-of"> · no cap</span></div>
      {budget != null ? <div className="cap-meta"><span>budget {fmtUsd(budget)}</span></div> : null}
    </div>;
  }
  const icon = usage.tone === "limit" ? "✕" : usage.tone === "warn" ? "▲" : "✓";
  return <div className={`cap-usage ${usage.tone}`}>
    <div className="cap-line"><b>{fmtUsd(usage.spend)}</b><span className="cap-of"> / {fmtUsd(usage.cap)}</span></div>
    <div className="cap-track" role="progressbar" aria-label={`Spend against hard cap: ${usage.label}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usage.rawPct)}>
      <span className="cap-fill" style={{ width: `${usage.pct}%` }} />
    </div>
    <div className="cap-meta">
      <span className="cap-state"><span aria-hidden="true">{icon}</span>{usage.label}</span>
      {usage.tone === "limit"
        ? <span>over by {fmtUsd(Math.max(0, usage.spend - usage.cap))}</span>
        : <span>{Math.round(usage.rawPct)}% used · {fmtUsd(usage.remaining)} left</span>}
    </div>
  </div>;
}

/** Compact evidence pointer for a ledger-backed record. */
export function EvidenceChip({ id, verified = true, href = "/api/v1/ledger/export", label = "verified" }: { id: string; verified?: boolean; href?: string; label?: string }) {
  const hash = `rec_${id.replace(/[^a-z0-9]/gi, "").slice(0, 7).toLowerCase()}`;
  return <a className={`evidence-chip${verified ? " is-verified" : ""}`} href={href} target="_blank" rel="noreferrer" title={verified ? "Open the signed evidence export" : "Evidence chain not checked"}>
    <span className="evidence-hash">{hash}</span>
    <span className="evidence-tick" aria-hidden="true">{verified ? "✓" : "?"}</span>
    <span className="evidence-label">{label}</span>
  </a>;
}

/** One status language for tables and trace decision rows. */
export function DecisionStrip({ decision, policy, approver }: { decision: "allowed" | "held" | "denied"; policy?: string | null; approver?: string | null }) {
  const icon = decision === "allowed" ? "✓" : decision === "held" ? "◷" : "✕";
  return <span className={`decision-strip ${decision}`}>
    <span className="decision-icon" aria-hidden="true">{icon}</span>
    <span>{decision === "allowed" ? "Allowed" : decision === "held" ? "Held" : "Denied"}</span>
    {policy ? <span className="policy" title={policy}>{policy}</span> : null}
    {approver ? <span className="approver" title={approver}>· {approver}</span> : null}
  </span>;
}

/** Cell content that clips to its column with the full value on hover. */
export const clipCell: CSSProperties = { display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" };

export function EmptyRow({ colSpan, children }: { colSpan: number; children: ReactNode }) {
  return <tr><td colSpan={colSpan} className="panel-note" style={{ padding: "22px 16px", textAlign: "center", whiteSpace: "normal" }}>{children}</td></tr>;
}

export function toNullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

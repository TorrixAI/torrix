import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CapUsage, DecisionStrip, EvidenceChip, Sparkline } from "../src/components";

function render(value: ReactNode): string {
  return renderToStaticMarkup(<>{value}</>);
}

describe("Sparkline", () => {
  test("renders nothing without a series", () => {
    expect(render(<Sparkline values={[]} />)).toBe("");
  });

  test("renders one point as a dot on the baseline", () => {
    const html = render(<Sparkline values={[7]} />);
    expect(html).toContain("<svg");
    expect(html).toContain("<circle");
    expect(html).toContain("M80.0");
    expect(html).not.toContain("NaN");
  });

  test("renders a two-point line", () => {
    const html = render(<Sparkline values={[1, 4]} />);
    expect(html.split("L").length - 1).toBe(1);
    expect(html).toContain("<circle");
    expect(html).not.toContain("NaN");
  });

  test("caps a long series at thirty points", () => {
    const html = render(<Sparkline values={Array.from({ length: 40 }, (_, index) => index)} accent />);
    expect(html.split("L").length - 1).toBe(29);
    expect(html).toContain("is-accent");
    expect(html).not.toContain("NaN");
  });

  test("renders bars with a tick for zero days and no line path", () => {
    const html = render(<Sparkline values={[0, 0, 2, 5]} bars accent />);
    expect(html).toContain("<rect");
    expect(html).toContain("sparkline-bar is-zero");
    expect(html).toContain("sparkline-bar is-last");
    expect(html).not.toContain("<path");
    expect(html).toContain("is-accent");
    expect(html).not.toContain("NaN");
  });

  test("caps a bar sparkline at thirty bars", () => {
    const html = render(<Sparkline values={Array.from({ length: 40 }, (_, index) => index + 1)} bars />);
    expect(html.split("<rect").length - 1).toBe(30);
  });
});

describe("CapUsage", () => {
  test("shows a bar, percentage and remaining below the warn threshold", () => {
    const html = render(<CapUsage spend={5} cap={10} budget={12} />);
    expect(html).toContain("role=\"progressbar\"");
    expect(html).toContain("Within cap");
    expect(html).toContain("50% used");
    expect(html).toContain("left");
    expect(html).toContain("width:50%");
  });

  test("labels near-cap and reached states in text, not colour alone", () => {
    expect(render(<CapUsage spend={8} cap={10} />)).toContain("Near cap");
    const reached = render(<CapUsage spend={12} cap={10} />);
    expect(reached).toContain("Cap reached");
    expect(reached).toContain("over by");
  });

  test("an uncapped key has no bar", () => {
    const html = render(<CapUsage spend={0.25} cap={null} budget={1} />);
    expect(html).toContain("no cap");
    expect(html).toContain("budget");
    expect(html).not.toContain("progressbar");
  });
});

describe("EvidenceChip", () => {
  test("shows a verified short hash and opens the signed export", () => {
    const html = render(<EvidenceChip id="Approval-7f2a99" />);
    expect(html).toContain("rec_approva");
    expect(html).toContain("✓");
    expect(html).toContain("verified");
    expect(html).toContain("/api/v1/ledger/export");
    expect(html).toContain("target=\"_blank\"");
  });

  test("shows an unchecked state without claiming verification", () => {
    const html = render(<EvidenceChip id="approval-1" verified={false} label="not checked" />);
    expect(html).toContain("?");
    expect(html).toContain("not checked");
    expect(html).not.toContain("verified");
  });
});

describe("DecisionStrip", () => {
  test("uses one status language with an icon and label", () => {
    const allowed = render(<DecisionStrip decision="allowed" policy="Read purchase orders" />);
    const held = render(<DecisionStrip decision="held" policy="Large purchases need approval" approver="maya" />);
    const denied = render(<DecisionStrip decision="denied" policy="Payroll export is blocked" />);
    expect(allowed).toContain("Allowed");
    expect(held).toContain("Held");
    expect(held).toContain("◷");
    expect(denied).toContain("Denied");
  });
});

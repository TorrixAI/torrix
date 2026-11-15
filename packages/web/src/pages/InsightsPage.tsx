import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useSearchParams } from "react-router-dom";
import { api, compact, fmtUsd, formatCount, formatPercent, type InsightsReport, type SavingsReport } from "../api";
import { PageError, PageLoading } from "./DashboardPage";

export default function InsightsPage() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const range = [7, 14, 30].includes(Number(params.get("range"))) ? Number(params.get("range")) : 7;

  const query = useQuery({
    queryKey: ["insights", range],
    queryFn: () => api<InsightsReport>(`/api/insights/generate?days=${range}`),
  });

  // Ranked, dollar-denominated savings. Separate endpoint from the insight
  // report, so it is fetched alongside it.
  const savingsQuery = useQuery({
    queryKey: ["insights-savings", range],
    queryFn: () => api<SavingsReport>(`/api/insights/savings?days=${range}`),
  });

  const recompute = useMutation({
    mutationFn: () => api<InsightsReport>(`/api/insights/generate?days=${range}`, { method: "POST", body: JSON.stringify({ days: range }) }),
    onSuccess: (data) => {
      queryClient.setQueryData(["insights", range], data);
      void queryClient.invalidateQueries({ queryKey: ["insights-savings", range] });
    },
  });

  const report = query.data;
  const savings = savingsQuery.data;
  const topSavings = savings?.recommendations[0] ?? null;

  if (query.isPending) return <PageLoading />;
  if (query.isError) return <PageError message={query.error.message} />;
  if (!report) return null;

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Insights & Optimizations</h1>
          <p className="page-sub">
            Automated recommendations for caching, model tiering (SLMs), cost anomalies and agent reliability.
          </p>
        </div>
        <div className="head-actions">
          <ToggleGroup
            className="range"
            type="single"
            value={String(range)}
            onValueChange={(value) => {
              if (!value) return;
              const next = new URLSearchParams(params);
              next.set("range", value);
              setParams(next);
            }}
          >
            {[7, 14, 30].map((value) => (
              <ToggleGroupItem key={value} value={String(value)} className={value === range ? "active" : ""}>
                {value}d
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button
            
            type="button"
            disabled={recompute.isPending}
            onClick={() => recompute.mutate()}
          >
            {recompute.isPending ? "Generating…" : "Generate now"}
          </Button>
        </div>
      </div>

      <div className="in-cards">
        <Link className="in-card" to="/ui/analytics">
          <div className="lbl">Spend</div>
          <div className="val">{fmtUsd(report.spendUsd)}</div>
          <div className="sub" title={report.priorSpendUsd != null ? `prior ${fmtUsd(report.priorSpendUsd)}` : "this window"}>
            {report.priorSpendUsd != null ? `prior ${fmtUsd(report.priorSpendUsd)}` : "this window"}
          </div>
        </Link>
        <Link className="in-card" to="/ui/runs">
          <div className="lbl">Runs</div>
          <div className="val">{formatCount(report.runs)}</div>
          <div className="sub" title={`error rate ${formatPercent(report.errorRate)}`}>error rate {formatPercent(report.errorRate)}</div>
        </Link>
        <Link className="in-card" to="/ui/runs?anomaly=1">
          <div className="lbl">Anomalies</div>
          <div className="val">{report.anomalyCount}</div>
          <div className="sub" title="flagged above baseline">flagged above baseline</div>
        </Link>
        <a className="in-card" href="#caching">
          <div className="lbl">Cache headroom</div>
          <div className="val">{fmtUsd(report.caching.totalPotentialSavingsUsd)}</div>
          <div className="sub" title="repeated prefixes">repeated prefixes</div>
        </a>
        <a className="in-card" href="#slm">
          <div className="lbl">SLM savings</div>
          <div className="val">{fmtUsd(report.slm.estimatedSavingsUsd)}</div>
          <div className="sub" title="estimated at 70%">estimated at 70%</div>
        </a>
        <a className="in-card" href="#savings">
          <div className="lbl">Savings found</div>
          <div className="val">{topSavings ? <>{fmtUsd(topSavings.monthly_usd)}<span className="in-mo">/mo</span></> : fmtUsd(0)}</div>
          <div className="sub" title={topSavings ? topSavings.title : "no opportunities in this window"}>
            {topSavings ? (topSavings.title.length > 46 ? `${topSavings.title.slice(0, 46)}…` : topSavings.title) : "no opportunities in this window"}
          </div>
        </a>
        <Link className="in-card" to="/ui/runs?source=mcp_gateway">
          <div className="lbl">MCP calls</div>
          <div className="val">{formatCount(report.mcp.calls)}</div>
          <div className="sub" title={`${formatCount(report.mcp.denied)} denied · ${formatCount(report.mcp.pending)} pending`}>
            {formatCount(report.mcp.denied)} denied · {formatCount(report.mcp.pending)} pending
          </div>
        </Link>
      </div>

      {report.highlights.length > 0 ? (
        <div className="panel mb-4.5">
          <div className="panel-head">
            <span className="panel-title"><span className="sig" />Highlights</span>
            <span className="panel-note">{report.generatedWith}</span>
          </div>
          <div className="panel-body in-highlights">
            <ul>
              {report.highlights.map((h, i) => {
                const tone = /\b(error|fail|anomal|risk|increase|spike)\b/i.test(h) ? "bad" : /\b(saving|save|down|lower|decrease|improve|healthy|within|good)\b/i.test(h) ? "good" : "neutral";
                return <li key={i}><span className={`in-highlight-dot ${tone}`} aria-hidden="true" /><span>{h}</span></li>;
              })}
            </ul>
          </div>
        </div>
      ) : null}

      {report.actions.length > 0 ? (
        <div className="panel mb-4.5">
          <div className="panel-head">
            <span className="panel-title"><span className="sig" />Suggested actions</span>
            <span className="panel-note">Immediate opportunities</span>
          </div>
          <div className="panel-body" style={{ padding: 14, display: "grid", gap: 8 }}>
            {report.actions.map((act, i) => (
              <Link
                key={i}
                to={act.href}
                className="in-action"
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "10px 14px",
                  borderRadius: "var(--r)",
                  border: "1px solid var(--line)",
                  background: "var(--surface)",
                  textDecoration: "none",
                  color: "inherit",
                }}
              >
                <span style={{ fontWeight: 600, fontSize: "13px", color: "var(--heading)" }}>{act.label}</span>
                <span className="text-[12px] panel-note">{act.detail} →</span>
              </Link>
            ))}
          </div>
        </div>
      ) : null}

      {savings ? (
        <div id="savings" className="panel mb-4.5">
          <div className="panel-head">
            <span className="panel-title">Savings opportunities</span>
            <span className="panel-note">Ranked by estimated monthly impact · last {range} days projected to 30</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Opportunity</th>
                  <th>Confidence</th>
                  <th className="num">Est. monthly</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {savings.recommendations.length ? (
                  savings.recommendations.map((item) => {
                    const model = item.evidence.models?.[0];
                    return (
                      <tr key={item.id}>
                        <td>
                          <span className="tcell-primary">{item.title}</span>
                          <span className="in-opp-detail">{item.detail}</span>
                        </td>
                        <td><span className={`in-conf ${item.confidence}`}>{item.confidence}</span></td>
                        <td className="num"><span className="in-usd">{fmtUsd(item.monthly_usd)}</span><span className="in-mo">/mo</span></td>
                        <td className="text-right">
                          {model ? <Button asChild variant="outline" size="sm"><Link to={`/ui/runs?model=${encodeURIComponent(model)}`}>View runs</Link></Button> : null}
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan={4} className="p-[14px] panel-note">
                      No dollar-denominated savings found in this window.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      <div id="caching" className="panel mb-4.5">
        <div className="panel-head">
          <span className="panel-title">Prompt prefix caching headroom</span>
          <span className="panel-note">Repeated prefixes and savings estimate</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Prompt prefix</th>
                <th className="num">Calls</th>
                <th className="num">Avg input tokens</th>
                <th className="num">Potential savings</th>
              </tr>
            </thead>
            <tbody>
              {report.caching.repeatedGroups.length ? (
                report.caching.repeatedGroups.map((group, idx) => (
                  <tr key={idx}>
                    <td className="text-[12px] tnum">
                      {group.promptPrefix}
                    </td>
                    <td className="num">{formatCount(group.calls)}</td>
                    <td className="num">{compact(group.avgInputTokens)}</td>
                    <td className="num" style={{ color: "var(--good)", fontWeight: 600 }}>
                      {fmtUsd(group.potentialSavingsUsd)}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-[14px] panel-note">
                    No repeated prompt prefixes detected in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div id="slm" className="panel mb-4.5">
        <div className="panel-head">
          <span className="panel-title">Small Language Model (SLM) substitution</span>
          <span className="panel-note">Tasks that could move to a smaller model</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Cluster / task</th>
                <th className="num">Runs</th>
                <th className="num">Spend</th>
                <th>Substitution suggestion</th>
              </tr>
            </thead>
            <tbody>
              {report.slm.opportunities.length ? (
                report.slm.opportunities.map((opp, idx) => (
                  <tr key={idx}>
                    <td className="tnum" style={{ fontSize: "12.5px" }}>{opp.cluster}</td>
                    <td className="num">{formatCount(opp.runs)}</td>
                    <td className="num">{fmtUsd(opp.spendUsd)}</td>
                    <td style={{ fontSize: "12.5px", color: "var(--text-2)" }}>{opp.suggestion}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-[14px] panel-note">
                    No SLM substitution clusters detected yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel mb-4.5">
        <div className="panel-head">
          <span className="panel-title">Agent attribution & error rates</span>
          <span className="panel-note">Across ingestion paths</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Agent</th>
                <th className="num">Runs</th>
                <th className="num">Cost</th>
                <th className="num">Errors</th>
              </tr>
            </thead>
            <tbody>
              {report.agents.length ? (
                report.agents.map((agent) => (
                  <tr key={agent.name}>
                    <td>
                      <Link to={`/ui/runs?agent=${encodeURIComponent(agent.name)}`}>
                        {agent.name}
                      </Link>
                    </td>
                    <td className="num">{formatCount(agent.runs)}</td>
                    <td className="num">{fmtUsd(agent.cost)}</td>
                    <td className="num" style={{ color: agent.errorCount > 0 ? "var(--bad)" : "inherit" }}>
                      {agent.errorCount}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={4} className="p-[14px] panel-note">
                    No agent-attributed runs in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel mb-4.5">
        <div className="panel-head">
          <span className="panel-title">MCP activity</span>
          <span className="panel-note">{formatCount(report.mcp.calls)} calls · {formatCount(report.mcp.denied)} denied · {formatCount(report.mcp.pending)} pending approval</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Tool</th>
                <th className="num">Runs</th>
                <th className="num">Cost</th>
              </tr>
            </thead>
            <tbody>
              {report.mcp.tools.length ? (
                report.mcp.tools.map((tool) => (
                  <tr key={tool.tool}>
                    <td className="text-[12px] tnum">{tool.tool}</td>
                    <td className="num">{formatCount(tool.runs)}</td>
                    <td className="num">{fmtUsd(tool.cost)}</td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="p-[14px] panel-note">
                    No MCP tool calls in this window.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

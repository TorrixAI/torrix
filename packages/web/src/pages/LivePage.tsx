import { Button } from "@/components/ui/button";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { createParser } from "eventsource-parser";
import { compact, fmtMs, fmtUsd, type Run } from "../api";
import { formatCount, formatDateTime, formatPercent } from "../api";

interface LiveRun extends Run {
  liveReceivedAt: number;
}

// The console streams runs with fetch + an Authorization header, because
// EventSource cannot set headers and a key in the query string would leak into
// request logs. This mirrors that approach so the feed works on both origins.
export default function LivePage() {
  const [runs, setRuns] = useState<LiveRun[]>([]);
  const [buffer, setBuffer] = useState<LiveRun[]>([]);
  const [isPaused, setIsPaused] = useState(false);
  const [status, setStatus] = useState<"connecting" | "connected" | "error" | "paused">("connecting");
  const isPausedRef = useRef(isPaused);
  isPausedRef.current = isPaused;
  const bufferRef = useRef<LiveRun[]>([]);
  bufferRef.current = buffer;

  const [sessionCost, setSessionCost] = useState(0);
  const [sessionRuns, setSessionRuns] = useState(0);
  const [sessionErrors, setSessionErrors] = useState(0);

  useEffect(() => {
    let closed = false;
    const controller = new AbortController();

    const ingest = (run: Run) => {
      if (!run.id) return;
      const liveItem: LiveRun = { ...run, liveReceivedAt: Date.now() };
      setSessionRuns((prev) => prev + 1);
      setSessionCost((prev) => prev + (Number(run.cost_usd) || 0));
      if (Number(run.status) >= 400 || run.error) setSessionErrors((prev) => prev + 1);
      if (isPausedRef.current) setBuffer((prev) => [liveItem, ...prev].slice(0, 500));
      else setRuns((prev) => [liveItem, ...prev].slice(0, 100));
    };

    const onEvent = (event: { data: string }) => {
      if (!event.data) return;
      try {
        const parsed = JSON.parse(event.data) as Record<string, unknown>;
        if (parsed.type === "connected" || parsed.type === "heartbeat" || parsed.type === "ping") {
          setStatus(isPausedRef.current ? "paused" : "connected");
          return;
        }
        ingest(parsed as unknown as Run);
      } catch {
        // heartbeat comments and unknown frames are ignored
      }
    };

    const connect = async (): Promise<void> => {
      while (!closed) {
        try {
          const key = localStorage.getItem("torrix_key");
          const response = await fetch("/api/stream", {
            headers: key ? { authorization: `Bearer ${key}` } : {},
            credentials: "include",
            signal: controller.signal,
          });
          if (!response.ok || !response.body) {
            setStatus("error");
          } else {
            setStatus(isPausedRef.current ? "paused" : "connected");
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            const parser = createParser({ onEvent });
            for (;;) {
              const { value, done } = await reader.read();
              if (done) break;
              parser.feed(decoder.decode(value, { stream: true }));
            }
          }
        } catch {
          if (closed) return;
        }
        if (closed) return;
        setStatus("error");
        await new Promise((resolve) => setTimeout(resolve, 3000));
      }
    };

    void connect();
    return () => {
      closed = true;
      controller.abort();
    };
  }, []);

  const togglePause = () => {
    setIsPaused((currentlyPaused) => {
      const next = !currentlyPaused;
      if (!next) {
        setRuns((currentRuns) => [...bufferRef.current, ...currentRuns].slice(0, 100));
        setBuffer([]);
        setStatus("connected");
      } else {
        setStatus("paused");
      }
      return next;
    });
  };

  const clearHistory = () => {
    setRuns([]);
    setBuffer([]);
  };

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Live feed</h1>
          <p className="page-sub">
            New runs stream in as they are captured in real-time. Pause to inspect without losing new events.
          </p>
        </div>
        <div className="head-actions">
          <span
            className={`badge ${
              status === "connected" ? "good" : status === "error" ? "bad" : "neutral"
            }`}
            style={{ textTransform: "capitalize", padding: "5px 11px" }}
          >
            <span className="dot" />
            {status}
          </span>
          <Button variant="outline" type="button" onClick={togglePause}>
            {isPaused ? "Resume stream" : "Pause stream"}
          </Button>
        </div>
      </div>

      <div className="stat-tiles">
        <div className="stat-tile">
          <span className="st-label">Runs this session</span>
          <div className="st-value">{formatCount(sessionRuns)}</div>
          <div className="st-sub">captured live</div>
        </div>
        <div className="stat-tile">
          <span className="st-label">Spend this session</span>
          <div className="st-value">{fmtUsd(sessionCost)}</div>
          <div className="st-sub">accumulated cost</div>
        </div>
        <div className={`stat-tile${sessionErrors > 0 ? " tone-bad" : " tone-good"}`}>
          <span className="st-label">Errors this session</span>
          <div className="st-value">{formatCount(sessionErrors)}</div>
          <div className="st-sub">{sessionRuns > 0 ? formatPercent((sessionErrors / sessionRuns) * 100) : "0.0%"} failure rate</div>
        </div>
      </div>

      <div className="panel">
        <div className="panel-head">
          <span className="panel-title">Incoming activity</span>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {buffer.length > 0 ? (
              <span className="badge neutral" style={{ fontFamily: "var(--sans)" }}>
                {buffer.length} buffered
              </span>
            ) : null}
            {runs.length > 0 ? (
              <Button variant="outline"
                
                type="button"
                style={{ padding: "3px 8px", fontSize: 11 }}
                onClick={clearHistory}
              >
                Clear table
              </Button>
            ) : null}
          </div>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>Run</th>
                <th>Agent</th>
                <th>Model</th>
                <th className="num">Tokens</th>
                <th className="num">Cost</th>
                <th className="num">Latency</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {runs.length > 0 ? (
                runs.map((run) => {
                  const isErr = Number(run.status) >= 400 || Boolean(run.error);
                  const totalTokens = (run.input_tokens ?? 0) + (run.output_tokens ?? 0);
                  const time = formatDateTime(run.created_at);
                  return (
                    <tr key={`${run.id}-${run.liveReceivedAt}`} className="clickable">
                      <td className="tnum" style={{ color: "var(--text-3)", fontSize: "11.5px" }}>
                        {time}
                      </td>
                      <td>
                        <Link to={`/ui/runs/${encodeURIComponent(run.id)}`} className="tcell-primary">
                          {run.name || "untitled"}
                        </Link>
                        {run.trace_id ? (
                          <span className="tcell-sub mono">
                            trace {run.trace_id.slice(-8)}
                          </span>
                        ) : null}
                      </td>
                      <td>
                        {run.agent_name ? (
                          <span className="chip">{run.agent_name}</span>
                        ) : (
                          <span className="panel-note">-</span>
                        )}
                      </td>
                      <td className="text-[12px] tnum">
                        {run.model || "-"}
                      </td>
                      <td className="num">{compact(totalTokens)}</td>
                      <td className="num">{fmtUsd(run.cost_usd)}</td>
                      <td className="num">{fmtMs(run.latency_ms)}</td>
                      <td>
                        <span className={`badge ${isErr ? "bad" : "good"}`}>
                          <span className="dot" />
                          {run.status ?? (isErr ? "error" : "200")}
                        </span>
                      </td>
                    </tr>
                  );
                })
              ) : (
                <tr>
                  <td colSpan={8} className="panel-note" style={{ padding: "24px 16px", textAlign: "center" }}>
                    Waiting for runs… Send a request through Torrix or trigger an LLM run to see it appear live.
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

import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { useEffect, useState } from "react";
import { Input } from "@/components/ui/input";
import { ThemeToggle, TorrixMark } from "../icons";
import { Trend } from "../components";
import { capUsage } from "@/lib/capUsage";
import { formatMoney } from "@/lib/format";

// Pre-auth surface. Served at /ui/login (the server route no longer renders
// HTML), so it must work with no session and set localStorage.torrix_key the
// same way the API client expects.

type Tab = "login" | "signup" | "key";

const CHECK = <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M3 8.5 6.5 12 13 4.5" /></svg>;
const EYE_ON = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" /><circle cx="12" cy="12" r="3" /></svg>;
const EYE_OFF = <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round"><path d="M3 3l18 18M10.6 5.1A10.6 10.6 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.2 6.2A17 17 0 0 0 2 12s3.6 7 10 7a10.6 10.6 0 0 0 4-.8" /><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" /></svg>;

// A small, honest preview of the first console screen: month-to-date spend
// climbing against the same days last month, dashed, plus the hard cap that
// enforces it. Fixed numbers, no data fetching, decorative only, so the pre-auth
// page stays static and cheap. The total, the peak, the delta and the cap gauge
// are all derived from these arrays, so the panel can never claim a number its
// own bars contradict.
const SIGNAL_SPEND = [1032, 1042, 1186, 1128, 1364, 1298, 1542, 1476, 1784, 1706, 1962, 2118, 2054, 2496, 2842];
const SIGNAL_PREV = [742, 728, 842, 796, 962, 918, 1088, 1042, 1256, 1204, 1382, 1498, 1452, 1764, 2012];
const SIGNAL_DATES: Array<[number, string]> = [[0, "1 Nov"], [4, "5 Nov"], [8, "9 Nov"], [12, "13 Nov"]];
const SIGNAL_BUDGET = 30_000;
const MONTH_DAYS = 30;

const sum = (values: number[]) => values.reduce((total, value) => total + value, 0);
const SIGNAL_TOTAL = sum(SIGNAL_SPEND);
const SIGNAL_PREV_TOTAL = sum(SIGNAL_PREV);
const SIGNAL_DAYS_LEFT = MONTH_DAYS - SIGNAL_SPEND.length;

function LoginSignal() {
  const BASE = 88;
  const TOP = 24;
  const BAR_W = 16;
  const STEP = 24;
  const peak = Math.max(...SIGNAL_SPEND);
  const LEFT = (396 - (BAR_W + (SIGNAL_SPEND.length - 1) * STEP)) / 2;
  const MAX = Math.max(peak, ...SIGNAL_PREV) * 1.06;
  const y = (value: number) => BASE - (value / MAX) * (BASE - TOP);
  const centre = (index: number) => LEFT + index * STEP + BAR_W / 2;
  const peakIndex = SIGNAL_SPEND.indexOf(peak);
  const usage = capUsage(SIGNAL_TOTAL, SIGNAL_BUDGET);
  return <div className="lg-panel">
    <div className="lg-panel-head">
      <span className="lg-panel-label">Spend, this month</span>
      <span className="lg-panel-figures">
        <span className="lg-panel-total">{formatMoney(SIGNAL_TOTAL)}</span>
        <Trend current={SIGNAL_TOTAL} previous={SIGNAL_PREV_TOTAL} metric="spend" />
      </span>
    </div>
    <svg className="lg-chart" viewBox="0 0 396 116" role="presentation">
      {[BASE, 66, 44, 22].map((line) => <line key={line} className="lg-chart-grid" x1={0} x2={396} y1={line} y2={line} />)}
      <polyline className="lg-chart-prev" points={SIGNAL_PREV.map((value, index) => `${centre(index)},${y(value)}`).join(" ")} />
      {SIGNAL_SPEND.map((value, index) => (
        <rect key={index} className={index === peakIndex ? "lg-bar is-peak" : "lg-bar"}
          x={LEFT + index * STEP} y={y(value)} width={BAR_W} height={BASE - y(value)} rx={2} />
      ))}
      <text className="lg-chart-peak" x={centre(peakIndex)} y={y(peak) - 8} textAnchor="middle">{formatMoney(peak)}</text>
      {SIGNAL_DATES.map(([index, label]) => (
        <text key={label} className="lg-day" x={centre(index)} y={104} textAnchor="middle">{label}</text>
      ))}
    </svg>
    <div className="lg-panel-legend"><span className="lg-legend-dash" />Same days last month</div>
    {usage ? <div className="lg-gauge">
      <div className="lg-gauge-track" role="progressbar" aria-label={`Spend against the monthly budget: ${usage.label}`}
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(usage.rawPct)}>
        <span className={`lg-gauge-fill ${usage.tone}`} style={{ width: `${usage.pct}%` }} />
      </div>
      <div className="lg-gauge-meta">
        <span className={`lg-gauge-state ${usage.tone}`}>
          <span aria-hidden="true">{usage.tone === "limit" ? "✕" : usage.tone === "warn" ? "▲" : "✓"}</span>{usage.label}
        </span>
        <span>{Math.round(usage.rawPct)}% of {formatMoney(SIGNAL_BUDGET)} · {SIGNAL_DAYS_LEFT} days left</span>
      </div>
    </div> : null}
  </div>;
}
;

export default function LoginPage() {
  const [tab, setTab] = useState<Tab>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showLoginPw, setShowLoginPw] = useState(false);
  const [signupEmail, setSignupEmail] = useState("");
  const [signupPassword, setSignupPassword] = useState("");
  const [showSignupPw, setShowSignupPw] = useState(false);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [error, setError] = useState("");
  const [signupKey, setSignupKey] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [ssoEnabled, setSsoEnabled] = useState(false);
  const [signupOpen, setSignupOpen] = useState(true);
  const [version, setVersion] = useState("");

  const next = new URLSearchParams(window.location.search).get("next") || "/ui/dashboard";

  useEffect(() => {
    const ssoError = new URLSearchParams(window.location.search).get("error");
    if (ssoError) setError(`Sign-in failed (${ssoError}).`);
    fetch("/auth/signup-status")
      .then((response) => (response.ok ? response.json() as Promise<{ open?: boolean }> : null))
      .then((data) => {
        if (data?.open === false) {
          setSignupOpen(false);
          setTab((current) => (current === "signup" ? "login" : current));
        }
      })
      .catch(() => {});
    fetch("/auth/oidc/status")
      .then((response) => (response.ok ? response.json() as Promise<{ enabled?: boolean }> : null))
      .then((data) => { if (data?.enabled) setSsoEnabled(true); })
      .catch(() => {});
    fetch("/health")
      .then((response) => (response.ok ? response.json() as Promise<{ version?: string }> : null))
      .then((data) => { if (data?.version) setVersion(data.version); })
      .catch(() => {});
    const stored = localStorage.getItem("torrix_key");
    if (stored) {
      fetch("/ui/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: stored }) })
        .then((response) => { if (response.ok) window.location.assign(next); })
        .catch(() => {});
    }
  }, [next]);

  const toggleTheme = () => {
    const element = document.documentElement;
    const theme = element.dataset.theme === "dark" ? "light" : "dark";
    element.dataset.theme = theme;
    localStorage.setItem("torrix_theme", theme);
  };

  const finish = (key: string) => {
    localStorage.setItem("torrix_key", key);
    window.location.assign(next);
  };

  const signIn = async () => {
    setError("");
    if (!email.trim() || !password) { setError("Enter your email and password."); return; }
    setPending(true);
    try {
      const response = await fetch("/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: email.trim(), password }) });
      const data = await response.json().catch(() => ({})) as { api_key?: string; error?: string };
      if (!response.ok || !data.api_key) {
        setError(data.error === "invalid_credentials" ? "Invalid email or password." : data.error || "Login failed. Please try again.");
        return;
      }
      finish(data.api_key);
    } catch {
      setError("Login failed. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const signUp = async () => {
    setError("");
    if (!signupEmail.trim() || signupPassword.length < 8) { setError("Enter a valid email and a password of at least 8 characters."); return; }
    setPending(true);
    try {
      const response = await fetch("/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: signupEmail.trim(), password: signupPassword }) });
      const data = await response.json().catch(() => ({})) as { api_key?: string; error?: string };
      if (!response.ok || !data.api_key) { setError(data.error || "Signup failed. Please try again."); return; }
      localStorage.setItem("torrix_key", data.api_key);
      setSignupKey(data.api_key);
    } catch {
      setError("Signup failed. Please try again.");
    } finally {
      setPending(false);
    }
  };

  const useKey = async () => {
    setError("");
    const key = apiKeyInput.trim();
    if (!key) { setError("Enter your API key."); return; }
    setPending(true);
    try {
      const response = await fetch("/ui/session", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ api_key: key }) });
      if (!response.ok) { setError("That key is not valid for this instance."); localStorage.removeItem("torrix_key"); return; }
      finish(key);
    } catch {
      setError("Could not validate that key.");
    } finally {
      setPending(false);
    }
  };

  const submit = () => { if (tab === "login") void signIn(); else if (tab === "signup") void signUp(); else void useKey(); };

  return <>
    <div className="lg-theme"><ThemeToggle onClick={toggleTheme} /></div>
    <div className="lg-shell">
      <aside className="lg-hero">
        <div className="lg-hero-inner">
          <div className="lg-brand"><TorrixMark className="brand-mark" /><div><span className="word">Torrix</span><span className="lg-edition">Self-hosted console</span></div></div>
          <div className="lg-hero-mid">
            <h1>The system of record<br /><span className="lg-acc">for AI agents.</span></h1>
            <p className="lg-lead">Observe every model call, control what agents may do, and keep verifiable evidence that an auditor can check.</p>
            <ul className="lg-points">
              <li>{CHECK}<span>Every run, tool call and decision in one ledger</span></li>
              <li>{CHECK}<span>Policies and approvals enforced before an agent acts</span></li>
              <li>{CHECK}<span>Self-hosted: your data never leaves this machine</span></li>
            </ul>
            <div className="lg-signal">
              <LoginSignal />
            </div>
          </div>
          <div className="lg-hero-foot">{version ? `Torrix v${version} · self-hosted` : "Torrix · self-hosted"}</div>
        </div>
      </aside>
      <main className="lg-main">
        <div className="lg-card">
          <div className="lg-card-head"><TorrixMark className="brand-mark" /><div><span className="word">Torrix</span><span className="lg-edition">Self-hosted console</span></div></div>
          <ToggleGroup className="lg-tabs console-tabs" type="single" value={tab} onValueChange={(value) => { if (!value) return; setTab(value as Tab); setError(""); }}>
            <ToggleGroupItem value="login" className={tab === "login" ? "active" : ""}>Sign in</ToggleGroupItem>
            {signupOpen ? <ToggleGroupItem value="signup" className={tab === "signup" ? "active" : ""}>Create account</ToggleGroupItem> : null}
            <ToggleGroupItem value="key" className={tab === "key" ? "active" : ""}>I have a key</ToggleGroupItem>
          </ToggleGroup>
          {signupOpen ? null : <p className="lg-hint lg-signup-closed">New accounts are created by an administrator.</p>}
          <form onSubmit={(event) => { event.preventDefault(); submit(); }}>
            {tab === "login" ? <div>
              <label htmlFor="lemail">Email</label>
              <Input id="lemail" type="email" autoComplete="email" placeholder="you@example.com" autoFocus value={email} onChange={(event) => setEmail(event.target.value)} />
              <label htmlFor="lpassword">Password</label>
              <div className="lg-field">
                <Input id="lpassword" type={showLoginPw ? "text" : "password"} autoComplete="current-password" placeholder="Your password" style={{ paddingRight: 40 }} value={password} onChange={(event) => setPassword(event.target.value)} />
                <Button variant="ghost" className="lg-eye" type="button" aria-label="Show password" onClick={() => setShowLoginPw((value) => !value)}>{showLoginPw ? EYE_OFF : EYE_ON}</Button>
              </div>
              {error ? <div className="field-error">{error}</div> : null}
              <Button className="lg-btn" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</Button>
              {ssoEnabled ? <a className="lg-btn ghost" href="/auth/oidc/login" style={{ display: "block", textAlign: "center", marginTop: 10, textDecoration: "none" }}>Continue with SSO</a> : null}
            </div> : null}
            {tab === "signup" ? <div>
              <label htmlFor="email">Email</label>
              <Input id="email" type="email" autoComplete="email" placeholder="you@example.com" value={signupEmail} onChange={(event) => setSignupEmail(event.target.value)} />
              <label htmlFor="password">Password</label>
              <div className="lg-field">
                <Input id="password" type={showSignupPw ? "text" : "password"} autoComplete="new-password" placeholder="At least 8 characters" style={{ paddingRight: 40 }} value={signupPassword} onChange={(event) => setSignupPassword(event.target.value)} />
                <Button variant="ghost" className="lg-eye" type="button" aria-label="Show password" onClick={() => setShowSignupPw((value) => !value)}>{showSignupPw ? EYE_OFF : EYE_ON}</Button>
              </div>
              {error ? <div className="field-error">{error}</div> : null}
              <Button className="lg-btn" type="submit" disabled={pending}>{pending ? "Creating account…" : "Create account & get API key"}</Button>
            </div> : null}
            {tab === "key" ? <div>
              <label htmlFor="apikey">API key</label>
              <Input id="apikey" type="text" className="mono" autoComplete="off" placeholder="trxk_..." style={{ fontFamily: "var(--mono)" }} value={apiKeyInput} onChange={(event) => setApiKeyInput(event.target.value)} />
              <p className="lg-hint">Paste a key and validate it against this instance.</p>
              {error ? <div className="field-error">{error}</div> : null}
              <Button className="lg-btn ghost" type="submit" disabled={pending}>{pending ? "Validating…" : "Sign in with key"}</Button>
            </div> : null}
          </form>
          {signupKey ? <div className="mt-3.5">
            <label>Your API key</label>
            <div className="keybox"><code>{signupKey}</code><Button variant="outline" size="icon" type="button" title="Copy key" onClick={() => void navigator.clipboard?.writeText(signupKey)}>Copy</Button></div>
            <p className="lg-hint">Shown once: store it somewhere safe. You can paste it back into “I have a key”.</p>
            <Button className="lg-btn mt-4.5" type="button" onClick={() => window.location.assign(next)}>Open dashboard</Button>
          </div> : null}
        </div>
      </main>
    </div>
  </>;
}

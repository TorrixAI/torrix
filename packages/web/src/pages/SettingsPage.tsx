import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Button, buttonVariants } from "@/components/ui/button";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api, formatDate, type DatabaseInfo, type LicenseInfo, type SettingsPermissions, type SsoConfig } from "../api";
import { ErrorText, Field, InlineSelect, Modal, Notice, PageHead, Panel } from "../components";
import { downloadFile } from "../download";

export default function SettingsPage() {
  const [section, setSection] = useState("database");
  const permissions = useQuery({ queryKey: ["permissions"], queryFn: () => api<SettingsPermissions>("/api/settings/permissions") });
  if (permissions.isPending) return <div className="startup loading-page"><span>Loading settings…</span></div>;
  if (permissions.isError) return <div className="empty mt-6.5"><span className="empty-title">Could not load settings</span><span className="empty-sub">{permissions.error.message}</span></div>;
  if (!permissions.data.is_admin) return <div className="empty mt-6.5"><span className="empty-title">Admins only</span><span className="empty-sub">Instance settings are restricted to administrators.</span></div>;
  const tabs = permissions.data.tabs;

  return <>
    <PageHead title="Settings" sub={`Instance configuration · ${permissions.data.edition} edition`} />
    <nav className="settings-nav console-tabs" aria-label="Settings sections">
      <a className={section === "database" ? "active" : ""} href="#settings-database" onClick={() => setSection("database")}>Database</a>
      <a className={section === "sampling" ? "active" : ""} href="#settings-sampling" onClick={() => setSection("sampling")}>Sampling</a>
      <a className={section === "users" ? "active" : ""} href="#settings-users" onClick={() => setSection("users")}>Users and backup</a>
      <a className={section === "license" ? "active" : ""} href="#settings-license" onClick={() => setSection("license")}>License</a>
      {tabs.includes("sso") ? <a className={section === "sso" ? "active" : ""} href="#settings-sso" onClick={() => setSection("sso")}>SSO</a> : null}
    </nav>
    <DatabaseSection />
    <SamplingSection />
    <UsersSection />
    <LicenseSection />
    {tabs.includes("sso") ? <SsoSection /> : null}
  </>;
}

function DatabaseSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["admin-db"], queryFn: () => api<DatabaseInfo>("/api/admin/db") });
  const [driver, setDriver] = useState<"sqlite" | "postgres">("sqlite");
  const [url, setUrl] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { if (query.data) setDriver(query.data.driver); }, [query.data]);
  const save = useMutation({
    mutationFn: () => api<{ swapped: boolean; seeded: boolean }>("/api/admin/db", { method: "POST", body: JSON.stringify({ driver, url: url || undefined }) }),
    onSuccess: (data) => { setMessage(`Switched to ${driver}${data.seeded ? " (admin user and keys seeded)" : ""}.`); void client.invalidateQueries({ queryKey: ["admin-db"] }); },
    onError: (error: Error) => setMessage(error.message),
  });
  return <Panel id="settings-database" className="settings-section" title="Database engine" note={query.data?.label}>
    <Notice>Torrix stores every run in a single SQLite file by default. Switch to PostgreSQL and swap back at any time: the change applies immediately, migrates the schema on the fly, and survives a restart.</Notice>
    {query.data?.envOverride ? <Notice>A TORRIX_DATABASE_URL environment override is set; switch it there instead.</Notice> : null}
    <Field label="Where should run data live?">
      <InlineSelect value={driver} onValueChange={(value) => setDriver(value as "sqlite" | "postgres")} disabled={query.data?.envOverride} options={[{ value: "sqlite", label: "SQLite: local file" }, { value: "postgres", label: "PostgreSQL: external server" }]} />
    </Field>
    {driver === "postgres" ? <Field label="Connection string"><Input value={url} placeholder="postgres://user:password@host:5432/torrix" onChange={(event) => setUrl(event.target.value)} /></Field> : null}
    {message ? <Notice>{message}</Notice> : null}
    <div className="action-row mt-3"><Button variant="outline" type="button" disabled={save.isPending || query.data?.envOverride || (driver === "postgres" && !url.trim())} onClick={() => setConfirming(true)}>Switch database</Button></div>
    {confirming ? <Modal title="Switch database" onClose={() => setConfirming(false)}>
      <p>Torrix will open the {driver} database, apply migrations and move this console session there. The current database stays on disk and is not deleted.</p>
      <p className="field-hint">Runs already stored in the current database will not be available until you switch back.</p>
      <div className="modal-actions">
        <Button variant="outline" type="button" onClick={() => setConfirming(false)}>Cancel</Button>
        <Button variant="outline" type="button" disabled={save.isPending} onClick={() => { setConfirming(false); save.mutate(); }}>Switch database</Button>
      </div>
    </Modal> : null}
  </Panel>;
}

function SamplingSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["sampling"], queryFn: () => api<{ sample_rate: number }>("/api/sampling-config") });
  const [rate, setRate] = useState("1");
  useEffect(() => { if (query.data) setRate(String(query.data.sample_rate)); }, [query.data]);
  const save = useMutation({ mutationFn: () => api("/api/sampling-config", { method: "PUT", body: JSON.stringify({ sample_rate: Number(rate) }) }), onSuccess: () => void client.invalidateQueries({ queryKey: ["sampling"] }) });
  return <Panel id="settings-sampling" className="settings-section" title="Global sampling" note="share of proxy traffic recorded">
    <Notice>Share of proxy traffic recorded as runs. 1 logs every call, 0 logs nothing except errors; per-request <code>x-torrix-sample</code> headers still override this value. Cost caps and policy checks always run.</Notice>
    <Field label="Sample rate (0 to 1)"><Input value={rate} inputMode="decimal" placeholder="0.25" onChange={(event) => setRate(event.target.value)} /></Field>
    {save.isError ? <ErrorText>{save.error.message}</ErrorText> : null}
    <div className="action-row mt-3"><Button type="button" disabled={save.isPending} onClick={() => save.mutate()}>Save sampling</Button></div>
  </Panel>;
}

function UsersSection() {
  const [message, setMessage] = useState<string | null>(null);
  const backup = async () => {
    setMessage(null);
    try { await downloadFile("/api/admin/backup", "torrix-backup.sqlite"); } catch (error) { setMessage((error as Error).message); }
  };
  return <Panel id="settings-users" className="settings-section" title="Users and backup" note="accounts and SQLite snapshots">
    <Notice>Projects, members and roles are managed on the Team page. Creating a user also creates their default project and first API key, shown once.</Notice>
    {message ? <Notice>{message}</Notice> : null}
    <div className="action-row mt-3">
      <Link className={buttonVariants({ variant: "outline" })} to="/ui/team">Open Team</Link>
      <Button variant="outline" type="button" onClick={() => void backup()}>Download SQLite backup</Button>
    </div>
  </Panel>;
}

function LicenseSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["license"], queryFn: () => api<LicenseInfo>("/api/license") });
  const [key, setKey] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const activate = useMutation({
    mutationFn: () => api<{ edition: string; licensee: string | null }>("/api/license", { method: "POST", body: JSON.stringify({ key: key.trim() }) }),
    onSuccess: (data) => { setMessage(`Activated ${data.edition}${data.licensee ? ` for ${data.licensee}` : ""}.`); setKey(""); void client.invalidateQueries({ queryKey: ["license"] }); },
    onError: (error: Error) => setMessage(error.message),
  });
  const deactivate = useMutation({ mutationFn: () => api("/api/license", { method: "DELETE" }), onSuccess: () => { setMessage("Reverted to the environment edition."); void client.invalidateQueries({ queryKey: ["license"] }); } });
  const info = query.data;
  return <Panel id="settings-license" className="settings-section" title="License" note={info ? `${info.edition} · ${info.source}` : undefined}>
    <Notice>Paste a signed license key to move this instance to pro or cloud. Keys are verified RSA-SHA256 against the public key in <code>TORRIX_LICENSE_PUBLIC_KEY</code>; the edition reverts to the environment default when deactivated.</Notice>
    {info?.source === "license" ? <Notice>Active: {info.edition}{info.licensee ? ` · ${info.licensee}` : ""}{info.expires_at ? ` · expires ${formatDate(info.expires_at)}` : ""}.</Notice> : null}
    <Field label="License key"><Input value={key} placeholder="payload.signature" onChange={(event) => setKey(event.target.value)} /></Field>
    {message ? <Notice>{message}</Notice> : null}
    <div className="action-row mt-3.5">
      <Button variant="outline" type="button" disabled={activate.isPending || !key.trim()} onClick={() => activate.mutate()}>Activate</Button>
      <Button variant="outline" type="button" disabled={deactivate.isPending} onClick={() => deactivate.mutate()}>Deactivate</Button>
    </div>
  </Panel>;
}

function SsoSection() {
  const client = useQueryClient();
  const query = useQuery({ queryKey: ["sso"], queryFn: () => api<SsoConfig>("/api/sso/config") });
  const config = query.data;
  const [issuer, setIssuer] = useState("");
  const [clientId, setClientId] = useState("");
  const [secret, setSecret] = useState("");
  const [scopes, setScopes] = useState("");
  const [redirect, setRedirect] = useState("");
  const [autoProvision, setAutoProvision] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!config) return;
    setIssuer(config.issuer ?? "");
    setClientId(config.client_id ?? "");
    setScopes(config.scopes ?? "");
    setRedirect(config.redirect_uri ?? "");
    setAutoProvision(config.auto_provision);
  }, [config]);
  const save = useMutation({
    mutationFn: () => api("/api/sso/config", { method: "PUT", body: JSON.stringify({ issuer, client_id: clientId, client_secret: secret || undefined, scopes, auto_provision: autoProvision, redirect_uri: redirect || undefined }) }),
    onSuccess: () => { setMessage("SSO settings saved."); setSecret(""); void client.invalidateQueries({ queryKey: ["sso"] }); },
    onError: (error: Error) => setMessage(error.message),
  });
  const clear = useMutation({ mutationFn: () => api("/api/sso/config", { method: "DELETE" }), onSuccess: () => { setMessage("SSO settings removed."); void client.invalidateQueries({ queryKey: ["sso"] }); } });
  return <Panel id="settings-sso" className="settings-section" title="Single sign-on (OIDC)" note={config?.configured ? `configured · ${config.source}` : "not configured"}>
    <Notice>Cloud edition. Values saved here override the <code>TORRIX_OIDC_*</code> environment variables; the client secret is stored in instance_config and never returned by the API.</Notice>
    <div className="form-grid">
      <Field label="Issuer URL"><Input value={issuer} placeholder="https://idp.example.com" onChange={(event) => setIssuer(event.target.value)} /></Field>
      <Field label="Client ID"><Input value={clientId} onChange={(event) => setClientId(event.target.value)} /></Field>
      <Field label="Client secret (blank keeps the current one)"><Input type="password" value={secret} placeholder={config?.has_secret ? "unchanged" : "secret"} onChange={(event) => setSecret(event.target.value)} /></Field>
      <Field label="Scopes"><Input value={scopes} placeholder="openid email profile" onChange={(event) => setScopes(event.target.value)} /></Field>
      <Field label="Redirect URI override (optional)"><Input value={redirect} placeholder="https://torrix.example.com/auth/oidc/callback" onChange={(event) => setRedirect(event.target.value)} /></Field>
    </div>
    <div className="flex items-center gap-2"><Checkbox id="cb-4" checked={autoProvision} onCheckedChange={(value) => setAutoProvision(value === true)} /><label htmlFor="cb-4" className="text-[13px] text-text-2">Auto-provision users on first sign-in</label></div>
    {message ? <Notice>{message}</Notice> : null}
    <div className="action-row mt-3.5">
      <Button variant="outline" type="button" disabled={save.isPending || !issuer.trim() || !clientId.trim()} onClick={() => save.mutate()}>Save SSO</Button>
      <Button variant="outline" type="button" disabled={clear.isPending} onClick={() => clear.mutate()}>Remove settings</Button>
    </div>
  </Panel>;
}

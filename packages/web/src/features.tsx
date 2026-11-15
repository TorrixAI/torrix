import { buttonVariants } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link, Navigate } from "react-router-dom";
import { api, type AppConfig } from "./api";
import { Panel } from "./components";

// Paid surfaces render an upgrade card instead of an error when the instance
// does not have the feature. /api/config lists the licensed feature ids.

const RANK: Record<string, number> = { community: 0, pro: 1, enterprise: 2, cloud: 2 };

export function editionName(edition: string | null | undefined): string {
  if (edition === "pro") return "Pro";
  if (edition === "enterprise" || edition === "cloud") return "Enterprise";
  return "Community";
}

interface LockedFeatureInfo { id: string; label: string; edition: string; pitch: string }

export function useFeatures(): { features: string[]; edition: string; ready: boolean } {
  const query = useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/api/config") });
  return { features: query.data?.features ?? [], edition: query.data?.edition ?? "community", ready: query.isSuccess };
}

export function useFeature(id: string): { allowed: boolean; ready: boolean } {
  const { features, ready } = useFeatures();
  return { allowed: features.includes(id), ready };
}

/**
 * The paid-surface card. Two states, from the same two fields the legacy console read:
 * an unlicensed instance asks for a license, and a licensed instance running the
 * Community build points at the paid image instead (activating again cannot help).
 */
export function UpgradeCard({ feature, label }: { feature: string; label?: string }) {
  const { edition } = useFeatures();
  const info = useQuery({
    queryKey: ["locked", feature],
    queryFn: () => api<{ feature: LockedFeatureInfo }>(`/api/locked/${encodeURIComponent(feature)}`),
    retry: false,
  });
  const info2 = info.data?.feature;
  const name = editionName(info2?.edition);
  const covered = (RANK[edition] ?? 0) >= (RANK[info2?.edition ?? "pro"] ?? 1);
  const title = label ?? info2?.label ?? feature;
  const pitch = info2?.pitch ?? `${title} is available on a paid edition.`;
  // The badge annotates the feature, so it sits beside the panel title; pushed to
  // the far right of a wide panel it reads as detached from what it describes.
  const badge = <span className="badge neutral">{covered ? `Included in your ${editionName(edition)} license` : name}</span>;
  return <Panel flush title={<span>{title} {badge}</span>}>
    <div className="locked-card" style={{ maxWidth: "none" }}>
      <p style={{ margin: 0, color: "var(--text-2)", lineHeight: 1.7 }}>
        {covered
          ? `Your ${editionName(edition)} license is active, but this server runs the Community build, which does not include ${name} features. Switch to the Torrix ${editionName(edition)} image and keep your data volume and license key. Your runs, settings and users carry over.`
          : pitch}
      </p>
      <div className="locked-actions action-row">
        <Link className={buttonVariants()} to={`/ui/locked/${feature}`}>{covered ? "How to switch" : `See what ${name} adds`}</Link>
        {covered ? null : <Link className={buttonVariants({ variant: "outline" })} to="/ui/settings">Activate a license</Link>}
      </div>
    </div>
  </Panel>;
}

export function LockedNotice({ feature, label, note }: { feature: string; label: string; note?: string }) {
  if (note) {
    return <Panel flush title={<span>{label} <span className="badge neutral">Paid</span></span>}>
      <div className="locked-card" style={{ maxWidth: "none" }}>
        <p style={{ margin: 0, color: "var(--text-2)", lineHeight: 1.7 }}>{note}</p>
        <div className="locked-actions action-row">
          <Link className={buttonVariants()} to={`/ui/locked/${feature}`}>See what it adds</Link>
        </div>
      </div>
    </Panel>;
  }
  return <UpgradeCard feature={feature} label={label} />;
}

/**
 * Route guard for paid pages: an unlicensed deep link lands on the upgrade page
 * instead of a page whose APIs answer 404.
 */
export function RequireFeature({ feature, children }: { feature: string; children: ReactNode }) {
  const { allowed, ready } = useFeature(feature);
  if (!ready) {
    return <div className="startup loading-page"><span>Loading…</span></div>;
  }
  if (!allowed) {
    return <Navigate to={`/ui/locked/${feature}`} replace />;
  }
  return <>{children}</>;
}

import { buttonVariants } from "@/components/ui/button";
import { useQuery } from "@tanstack/react-query";
import { Link, useParams } from "react-router-dom";
import { api, type AppConfig } from "../api";
import { PageHead, Panel } from "../components";

interface LockedFeature { id: string; label: string; edition: string; pitch: string }

const RANK: Record<string, number> = { community: 0, pro: 1, enterprise: 2, cloud: 2 };
function editionName(edition: string): string {
  return edition === "pro" ? "Pro" : edition === "enterprise" || edition === "cloud" ? "Enterprise" : "Community";
}

export default function LockedPage() {
  const { feature = "" } = useParams();
  const featureQuery = useQuery({ queryKey: ["locked", feature], queryFn: () => api<{ feature: LockedFeature }>(`/api/locked/${encodeURIComponent(feature)}`), retry: false });
  const configQuery = useQuery({ queryKey: ["config"], queryFn: () => api<AppConfig>("/api/config") });

  if (featureQuery.isPending || configQuery.isPending) return <div className="startup loading-page"><span>Loading…</span></div>;
  if (featureQuery.isError) return <div className="empty mt-6.5"><span className="empty-title">Unknown feature</span><span className="empty-sub">{featureQuery.error.message}</span></div>;
  const info = featureQuery.data.feature;
  const current = configQuery.data?.edition ?? "community";
  const name = editionName(info.edition);
  const covers = (RANK[current] ?? 0) >= (RANK[info.edition] ?? 0);

  return <>
    <PageHead title={info.label} sub={covers ? `Included in your ${editionName(current)} license · not in this build` : `Available on Torrix ${name} · this instance runs ${editionName(current)}`} />
    <Panel>
      <div className="locked-card" style={{ display: "grid", gap: 12 }}>
        <span className="badge neutral" style={{ justifySelf: "start" }}>{name}</span>
        <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.7 }}>{info.pitch}</p>
        <p style={{ margin: 0, color: "var(--text)", lineHeight: 1.7 }}>{covers
          ? `Your license covers this feature, but this server runs the Community image, which does not contain the paid features. Switch to the Torrix ${editionName(current)} image and keep your data volume and license key. Your runs, settings and users carry over.`
          : "Paid editions run on your own infrastructure like the community edition, so captured data still never leaves your host."}</p>
        <div className="locked-actions action-row">
          {covers ? null : <Link className={buttonVariants()} to="/ui/settings">Activate a license</Link>}
          <Link className={buttonVariants({ variant: "outline" })} to="/ui/dashboard">Back to dashboard</Link>
        </div>
      </div>
    </Panel>
  </>;
}

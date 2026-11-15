import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "./api";

export function SecretNotice() {
  const query = useQuery({
    queryKey: ["secret-notice"],
    queryFn: () => api<{ count: number; masking: boolean }>("/api/security/secret-notice"),
  });
  const count = query.data?.count ?? 0;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (count <= 0) return;
    try { setDismissed(localStorage.getItem(`torrix_secret_notice_dismissed_${count}`) === "1"); } catch { setDismissed(false); }
  }, [count]);
  if (count <= 0 || dismissed) return null;
  const dismiss = () => {
    try { localStorage.setItem(`torrix_secret_notice_dismissed_${count}`, "1"); } catch { /* private mode */ }
    setDismissed(true);
  };
  const label = count === 1 ? "1 run contains" : `${count} runs contain`;
  return <div className="secret-notice" data-test="secret-notice" data-secret-count={count}>
    <div><strong>{label} what looks like an access token.</strong>
      <span>Turn on masking or delete them. The values are not shown here.</span></div>
    <div className="secret-notice-actions">
      <Link className="btn btn-ghost" to="/ui/governance">Review masking</Link>
      <button className="btn btn-ghost" type="button" onClick={dismiss}>Dismiss</button>
    </div>
  </div>;
}

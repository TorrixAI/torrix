// Auth-protected downloads cannot use a plain <a href> because the bearer token
// (localStorage) is not sent with navigations. Fetch with the header, then save
// the blob under the server-provided filename.
export async function downloadFile(url: string, fallbackName: string): Promise<void> {
  const key = localStorage.getItem("torrix_key");
  const response = await fetch(url, {
    headers: key ? { authorization: `Bearer ${key}` } : {},
    credentials: "include",
  });
  if (!response.ok) {
    let reason = `Download failed (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) reason = body.error;
    } catch {
      // non-JSON error body
    }
    throw new Error(reason);
  }
  const blob = await response.blob();
  const disposition = response.headers.get("content-disposition") ?? "";
  const match = /filename="?([^";]+)"?/.exec(disposition);
  const name = match?.[1] ?? fallbackName;
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(link.href);
}

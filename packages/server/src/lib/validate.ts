const LOOPBACK_NAMES = /^(localhost|localhost\.localdomain)$/i;
const PRIVATE_IPV4 = /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|0\.)/;
const IPV6_LOOPBACK = /^(::1?|0:0:0:0:0:0:0:1)$/;
const IPV6_ULA = /^f[cd][0-9a-f]{0,3}:/i;
const IPV6_LINK_LOCAL = /^fe[89ab][0-9a-f]{0,2}:/i;
const IPV6_MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;
const IPV6_MAPPED_DOTTED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

const BLOCKED_HOSTNAMES: Record<string, string> = {
  "0.0.0.0": "localhost_blocked",
  "169.254.169.254": "metadata_host_blocked",
  metadata: "metadata_host_blocked",
  "metadata.google.internal": "metadata_host_blocked",
  "metadata.internal": "metadata_host_blocked",
  "instance-data": "metadata_host_blocked",
  "instance-data.ec2.internal": "metadata_host_blocked",
  "kubernetes.default": "private_ip_blocked",
  "kubernetes.default.svc": "private_ip_blocked",
};

export interface UrlValidation {
  valid: boolean;
  reason?: string;
  url?: URL;
}

export function validateTargetUrl(rawTarget: string, allowLocalhost: boolean): UrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(rawTarget);
  } catch {
    return { valid: false, reason: "invalid_url" };
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    return { valid: false, reason: "non_http_protocol" };
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, "");
  const blocked = blockedReason(host);
  if (blocked) {
    if (allowLocalhost && blocked === "localhost_blocked") {
      return { valid: true, url: parsed };
    }
    return { valid: false, reason: blocked };
  }

  return { valid: true, url: parsed };
}

function blockedReason(host: string): string | null {
  const h = host.toLowerCase();
  const named = BLOCKED_HOSTNAMES[h];
  if (named) {
    return named;
  }
  if (LOOPBACK_NAMES.test(h)) {
    return "localhost_blocked";
  }
  if (h.includes(":")) {
    if (IPV6_LOOPBACK.test(h)) {
      return "localhost_blocked";
    }
    const mappedDotted = IPV6_MAPPED_DOTTED.exec(h);
    if (mappedDotted) {
      return blockedReason(mappedDotted[1]);
    }
    const mappedHex = IPV6_MAPPED_HEX.exec(h);
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16);
      const lo = parseInt(mappedHex[2], 16);
      return blockedReason(`${(hi >> 8) & 255}.${hi & 255}.${(lo >> 8) & 255}.${lo & 255}`);
    }
    if (IPV6_ULA.test(h) || IPV6_LINK_LOCAL.test(h)) {
      return "private_ip_blocked";
    }
    return null;
  }
  if (PRIVATE_IPV4.test(h)) {
    return h.startsWith("127.") || h === "0.0.0.0" ? "localhost_blocked" : "private_ip_blocked";
  }
  return null;
}

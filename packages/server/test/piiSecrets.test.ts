import { expect, test } from "bun:test";
import { SECRET_TYPES, containsSecret, scanAndMask } from "../src/lib/pii";

const secrets = [
  ["github_pat", `github_pat_${"A".repeat(30)}`],
  ["github_oauth", `gho_${"B".repeat(24)}`],
  ["github_user", `ghu_${"C".repeat(24)}`],
  ["github_server", `ghs_${"D".repeat(24)}`],
  ["github_refresh", `ghr_${"E".repeat(24)}`],
  ["aws_access_key", `AKIA${"F".repeat(16)}`],
  ["aws_temp_key", `ASIA${"G".repeat(16)}`],
  ["aws_secret", `aws_secret_access_key=${"h".repeat(40)}`],
  ["google_api_key", `AIza${"i".repeat(35)}`],
  ["private_key", `-----BEGIN PRIVATE KEY-----\n${"j".repeat(64)}\n-----END PRIVATE KEY-----`],
  ["jwt", `eyJ${"k".repeat(20)}.${"l".repeat(20)}.${"m".repeat(20)}`],
  ["bearer", `Authorization: Bearer ${"n".repeat(24)}`],
] as const;

const nearMisses = [
  `github_pat_${"A".repeat(10)}`,
  `gho_${"B".repeat(8)}`,
  `ghu_${"C".repeat(8)}`,
  `ghs_${"D".repeat(8)}`,
  `ghr_${"E".repeat(8)}`,
  `AKIA${"F".repeat(8)}`,
  `ASIA${"G".repeat(8)}`,
  `aws_secret_access_key=${"h".repeat(20)}`,
  `AIza${"i".repeat(34)}`,
  `-----BEGIN PRIVATE KEY-----\n${"j".repeat(64)}`,
  `eyJ${"k".repeat(20)}.${"l".repeat(20)}`,
  `Authorization: Bearer ${"n".repeat(8)}`,
  `Authorization: Basic ${"o".repeat(24)}`,
  "a normal prompt with an email address alice@example.com",
];

test("secret detectors catch every supported shape", () => {
  for (const [label, secret] of secrets) {
    expect(containsSecret(`prefix ${secret} suffix`), label).toBe(true);
    const masked = scanAndMask(`prefix ${secret} suffix`, SECRET_TYPES, "[redacted]");
    expect(masked.masked, label).toBe(true);
    expect(masked.text, label).not.toContain(secret);
    expect(masked.text, label).toContain("[redacted]");
  }
});

test("secret detectors ignore near misses and ordinary prompts", () => {
  for (const value of nearMisses) {
    expect(containsSecret(value), value).toBe(false);
    expect(scanAndMask(value, SECRET_TYPES, "[redacted]").masked, value).toBe(false);
  }
});

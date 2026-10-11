import { expect, test } from "bun:test";
import { validateTargetUrl } from "../src/lib/validate";

test("validateTargetUrl blocks metadata, link-local, CGNAT and IPv6 private ranges", () => {
  const blocked = [
    "http://169.254.169.254/latest/meta-data",
    "http://169.254.1.1/",
    "http://metadata.google.internal/computeMetadata/v1",
    "http://metadata.internal/",
    "http://[fd00::1]/",
    "http://[fe80::1]/",
    "http://[::1]/",
    "http://[::]/",
    "http://[::ffff:10.0.0.1]/",
    "http://[::ffff:a00:1]/",
    "http://10.0.0.1/",
    "http://172.20.1.1/",
    "http://192.168.1.1/",
    "http://100.64.0.1/",
    "http://100.127.255.1/",
    "http://127.0.0.1:8080/",
    "http://0.0.0.0/",
    "ftp://api.openai.com/",
  ];
  for (const url of blocked) {
    expect(`${url} => ${validateTargetUrl(url, false).valid}`).toBe(`${url} => false`);
  }

  const allowed = ["https://api.openai.com/v1/chat/completions", "http://100.128.0.1/", "http://203.0.113.7/"];
  for (const url of allowed) {
    expect(validateTargetUrl(url, false).valid).toBe(true);
  }
});

test("validateTargetUrl permits only localhost when local host rewriting is enabled", () => {
  expect(validateTargetUrl("http://localhost:11434/v1", true).valid).toBe(true);
  expect(validateTargetUrl("http://127.0.0.1:8080/v1", true).valid).toBe(true);
  expect(validateTargetUrl("http://169.254.169.254/", true).valid).toBe(false);
  expect(validateTargetUrl("http://metadata.google.internal/", true).valid).toBe(false);
  expect(validateTargetUrl("http://10.0.0.5/", true).valid).toBe(false);
});

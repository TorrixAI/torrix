import type { TrustedKey } from "./editions";

// Public halves only. The matching private keys never live in this repository;
// licenses name their signing key with `kid` so keys can rotate.
export const TRUSTED_LICENSE_KEYS: readonly TrustedKey[] = [
  {
    kid: "k1",
    pem: `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEA2eaxzhapMtYfIeIV5LTO
PrSLlVFN0cV9yQYqguDhjYe6O+KUgwz29PcFb8+EGN5OqgAUr/be2As4/OUYrMHU
ue4CnwnHV34mFzGUB6E8umcGFjdSN6H1nKoO+aHaZIMF246/e7sEflkZkyB4xFvy
2AEv0n05lY45BPyIw1+MACt0+Zv9ow+4441HJuZgVM4K4T3ax4Ck6oXdYLWovxYx
itGbZ7t7FJbivBMcACzwaK3b6vznj3GrbGgqMObRzBpHI9vk5DEMiThL3y8GSo5q
Ku0p57ogHF1Ep9Rhlk9GFUHya95/boB/0B7szcXc2lMplsy5bSHXypsgp86zYNF7
2LFNTqHD+6fJlFVh9pr8Rik0i/9y66p+K/9wwHBf+G2lcS8o4O2v+G5z5iR5VZNx
s0X7zl1Ajj8qJBSDih4Nr99ZC6zMObQ8fjnwnemDV2uhoL1XYyE+Z+7OAJ6wf3n9
QUAJyiZWWY3s6kq9gQ6Nzgf91PkR3JmUWXyAY3faSUdZAgMBAAE=
-----END PUBLIC KEY-----`,
  },
];

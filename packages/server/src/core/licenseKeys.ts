import type { TrustedKey } from "./editions";

// Public halves only. The matching private keys never live in this repository;
// licenses name their signing key with `kid` so keys can rotate.
export const TRUSTED_LICENSE_KEYS: readonly TrustedKey[] = [
  {
    // k1: generated 2026-11-08 on the macOS release machine. Nothing was sold
    // under the previous key, so this replaces it outright; keep this kid until
    // a real rotation (k2, k3, ...) is needed.
    kid: "k1",
    pem: `-----BEGIN PUBLIC KEY-----
MIIBojANBgkqhkiG9w0BAQEFAAOCAY8AMIIBigKCAYEAm7S9x6uRiNJ3aRImxrTe
kLtcbpTZjxDoO8Kgw0wDsfahOATb4ssWFceRwc7Yy7Fo3Fv9PsStRMer+ctAMw79
5A7MG9yMk38cXgvCOZ0rBmlYwzHU32MlOHhssTbmBYbiY/C2nTA4GHLNA4i0Y8wB
u1eF6dkq5MIUadv/hvPDOqakiURoEzEKzJ+CqTD2oMzixV/U1J6uCNvrKMb/BBoD
gP1lBPUtr5CvDq85X3W8RNChb+QLp35xro3YdujKfXU70uQxeUteYmfQ3l8ssHVH
FeXegNSf+I9fVY4A0cfhH2/+nFFi8w8MGnKuL7+FEvprhP/ZcjwkgdbvRucXxOMA
TS2Hy/pVoDIQpooQKTTetN2Fa8BMnwiCJ57uBmqOh8BVel+/49QRr3DZojuIROa7
SN9+FNXzEJ8hb/TyN6le20JOBVFCo443nbGNeBXXjnRSXhSQ2gc4w7nbHFmIeoew
QqMapLumJxTR16xWtrOERrP/3YsWangdH51Ru3klFqBdAgMBAAE=
-----END PUBLIC KEY-----`,
  },
];

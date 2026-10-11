// Bun loads these files through the `type` import attribute; TypeScript 5.x
// needs plain wildcard declarations (bun-types only ships the attribute-aware
// versions for TypeScript 7).
declare module "*.sql" {
  const text: string;
  export default text;
}

declare module "*.png" {
  const path: string;
  export default path;
}

declare module "*.woff2" {
  const path: string;
  export default path;
}

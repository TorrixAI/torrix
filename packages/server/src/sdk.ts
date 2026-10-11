/// <reference path="./assets/modules.d.ts" />
// Public surface for separately distributed Torrix editions. Extensions import
// from "@torrix/server" (this file) or "@torrix/server/testing", never from deep
// source paths, so the core can be refactored without breaking them.
export { startServer, type StartOptions } from "./server";
export { buildApp, type AppDeps, type BuildAppOptions } from "./app";
export { ExtensionHost } from "./core/extensionHost";
export type { ExtensionContext, FeatureDescriptor, LicenseGate, PeriodicTask, TorrixExtension } from "./core/extensions";
export { editionAtLeast, parseEdition, type Edition, type EditionConfig, type ServerConfig } from "./core/config";
export type { MigrationDirs } from "./db/migrate";

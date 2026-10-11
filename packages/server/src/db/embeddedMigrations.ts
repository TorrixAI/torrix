// Core SQL migrations embedded at build time. Bun inlines every text import,
// so a compiled binary needs no drizzle folder beside it; dev, Docker and
// tests read the same text through these imports. Add each new migration file
// here; `test/migrations.test.ts` fails when one is missing from the maps.
import sqlite0001 from "../../drizzle/0001_init.sql" with { type: "text" };
import sqlite0002 from "../../drizzle/0002_prompts.sql" with { type: "text" };
import sqlite0003 from "../../drizzle/0003_eval.sql" with { type: "text" };
import sqlite0004 from "../../drizzle/0004_cost.sql" with { type: "text" };
import sqlite0005 from "../../drizzle/0005_governance.sql" with { type: "text" };
import sqlite0006 from "../../drizzle/0006_agent_control.sql" with { type: "text" };
import sqlite0007 from "../../drizzle/0007_approval_notify.sql" with { type: "text" };
import sqlite0008 from "../../drizzle/0008_media.sql" with { type: "text" };
import sqlite0009 from "../../drizzle/0009_alert_tuning.sql" with { type: "text" };
import sqlite0010 from "../../drizzle/0010_trace_tree.sql" with { type: "text" };
import sqlite0011 from "../../drizzle/0011_webhook_signing.sql" with { type: "text" };
import sqlite0012 from "../../drizzle/0012_prompt_compression.sql" with { type: "text" };
import sqlite0013 from "../../drizzle/0013_project_members.sql" with { type: "text" };
import sqlite0014 from "../../drizzle/0014_judge_online.sql" with { type: "text" };
import sqlite0015 from "../../drizzle/0015_routing_prompt_active.sql" with { type: "text" };
import sqlite0016 from "../../drizzle/0016_agent_federation.sql" with { type: "text" };
import sqlite0017 from "../../drizzle/0017_agent_grant.sql" with { type: "text" };
import sqlite0018 from "../../drizzle/0018_notify_channels.sql" with { type: "text" };
import sqlite0019 from "../../drizzle/0019_guardrails.sql" with { type: "text" };
import sqlite0020 from "../../drizzle/0020_mcp_oauth.sql" with { type: "text" };
import sqlite0021 from "../../drizzle/0021_gateway_attestation.sql" with { type: "text" };
import pg0001 from "../../drizzle-pg/0001_init.sql" with { type: "text" };
import pg0002 from "../../drizzle-pg/0002_prompts.sql" with { type: "text" };
import pg0003 from "../../drizzle-pg/0003_eval.sql" with { type: "text" };
import pg0004 from "../../drizzle-pg/0004_cost.sql" with { type: "text" };
import pg0005 from "../../drizzle-pg/0005_governance.sql" with { type: "text" };
import pg0006 from "../../drizzle-pg/0006_agent_control.sql" with { type: "text" };
import pg0007 from "../../drizzle-pg/0007_approval_notify.sql" with { type: "text" };
import pg0008 from "../../drizzle-pg/0008_media.sql" with { type: "text" };
import pg0009 from "../../drizzle-pg/0009_alert_tuning.sql" with { type: "text" };
import pg0010 from "../../drizzle-pg/0010_trace_tree.sql" with { type: "text" };
import pg0011 from "../../drizzle-pg/0011_webhook_signing.sql" with { type: "text" };
import pg0012 from "../../drizzle-pg/0012_prompt_compression.sql" with { type: "text" };
import pg0013 from "../../drizzle-pg/0013_project_members.sql" with { type: "text" };
import pg0014 from "../../drizzle-pg/0014_judge_online.sql" with { type: "text" };
import pg0015 from "../../drizzle-pg/0015_routing_prompt_active.sql" with { type: "text" };
import pg0016 from "../../drizzle-pg/0016_agent_federation.sql" with { type: "text" };
import pg0017 from "../../drizzle-pg/0017_agent_grant.sql" with { type: "text" };
import pg0018 from "../../drizzle-pg/0018_notify_channels.sql" with { type: "text" };
import pg0019 from "../../drizzle-pg/0019_guardrails.sql" with { type: "text" };
import pg0020 from "../../drizzle-pg/0020_mcp_oauth.sql" with { type: "text" };
import pg0021 from "../../drizzle-pg/0021_gateway_attestation.sql" with { type: "text" };
import type { MigrationFiles } from "./migrate";

export const EMBEDDED_CORE_MIGRATIONS: MigrationFiles = {
  sqlite: {
    "0001_init.sql": sqlite0001,
    "0002_prompts.sql": sqlite0002,
    "0003_eval.sql": sqlite0003,
    "0004_cost.sql": sqlite0004,
    "0005_governance.sql": sqlite0005,
    "0006_agent_control.sql": sqlite0006,
    "0007_approval_notify.sql": sqlite0007,
    "0008_media.sql": sqlite0008,
    "0009_alert_tuning.sql": sqlite0009,
    "0010_trace_tree.sql": sqlite0010,
    "0011_webhook_signing.sql": sqlite0011,
    "0012_prompt_compression.sql": sqlite0012,
    "0013_project_members.sql": sqlite0013,
    "0014_judge_online.sql": sqlite0014,
    "0015_routing_prompt_active.sql": sqlite0015,
    "0016_agent_federation.sql": sqlite0016,
    "0017_agent_grant.sql": sqlite0017,
    "0018_notify_channels.sql": sqlite0018,
    "0019_guardrails.sql": sqlite0019,
    "0020_mcp_oauth.sql": sqlite0020,
    "0021_gateway_attestation.sql": sqlite0021,
  },
  postgres: {
    "0001_init.sql": pg0001,
    "0002_prompts.sql": pg0002,
    "0003_eval.sql": pg0003,
    "0004_cost.sql": pg0004,
    "0005_governance.sql": pg0005,
    "0006_agent_control.sql": pg0006,
    "0007_approval_notify.sql": pg0007,
    "0008_media.sql": pg0008,
    "0009_alert_tuning.sql": pg0009,
    "0010_trace_tree.sql": pg0010,
    "0011_webhook_signing.sql": pg0011,
    "0012_prompt_compression.sql": pg0012,
    "0013_project_members.sql": pg0013,
    "0014_judge_online.sql": pg0014,
    "0015_routing_prompt_active.sql": pg0015,
    "0016_agent_federation.sql": pg0016,
    "0017_agent_grant.sql": pg0017,
    "0018_notify_channels.sql": pg0018,
    "0019_guardrails.sql": pg0019,
    "0020_mcp_oauth.sql": pg0020,
    "0021_gateway_attestation.sql": pg0021,
  },
};

# Using the console

The console is the browser UI on your Torrix server (http://localhost:8088 by default). This page
is a tour of what each screen does. For what the data means, read
[How Torrix organizes your data](concepts.md); for the paid features, see
[Pro and Enterprise features](pro-and-enterprise.md).

## The shell

- The sidebar groups pages into **Observability**, **Management** and **System**.
- The search box in the topbar, or Ctrl/Cmd+K, opens the command palette: jump to any page, or
  search runs by name, model or metadata.
- The theme toggle switches between the light and dark console and remembers your choice.
- The runs, traces and drill-in pages have a manual **Refresh** next to an **Auto** toggle that
  reloads every 15 seconds. Both the toggle and the Tree/Flow choice are remembered per browser.

## Projects and the scope selector

Every run is stored in a project. The selector in the topbar decides which project the run-derived
pages show:

- **All projects** (the default): everything your account can see.
- **One project**: only that project's runs.

Once you pick a project, the choice sticks. Dashboard, Analytics, Runs, Traces, Agents, Live feed,
Insights and Cost all follow it as you move around, so you do not have to pick it again on every
page. Choosing **All projects** clears it. A link that names a project, such as a drill-through from
Analytics or the admin project table, overrides the stored choice for that visit and becomes the new
scope.

Governance, the review queue and audit log, the Team page's admin tables and the SQL console stay
account-wide: they are about the instance, not about one project.

## Dashboard

Spend, runs, tokens, latency and error rate for the last 7, 14 or 30 days, with the change against
the previous window. Below the KPI cards: a spend and telemetry chart per day, agent activity, MCP
activity and a live feed panel. Every number links to the filtered evidence on the Runs page.

## Runs

The main list, newest first by default.

- Filters: score (good, bad, unscored), flagged, anomalies, review state, model, provider, source,
  agent, end user, tag and free-text search; project chips switch scope.
- Sort by newest, cost, latency or tokens, ascending or descending.
- Bulk actions on a selection: mark good or bad, judge (paid), delete, compare.
- Export as CSV, NDJSON, OpenAI fine-tune JSONL or small-model JSONL.
- **Group by session or trace**: the server pages by group, so each header carries whole-group
  totals (runs, agents, subagents, cost, tokens, errors, span) even when a group is large.
- Each row shows the agent chip, session and trace links, and markers for child runs, tool calls and
  reasoning.

## Traces and sessions

The Traces page lists two things: **sessions** (a whole conversation) and **traces** (one agent
execution, including the subagent runs it spawns).

- Single-run groups are hidden by default, with a toggle to show them. There is a text filter over
  id, agents and prompt, and an errors-only filter.
- Columns: last activity, prompt excerpt, root agent, agents, runs, subagents, duration, cost and
  errors.

Opening a trace or session gives you a drill-in with two views:

- **Tree**: every run as a row, parent and child linked with guides. Branches collapse. A run with
  captured tool calls or reasoning has an expander that shows them inline: tool name and arguments,
  and the reasoning text. Policy flags appear as child rows. In paid editions, authorization
  decisions appear under the run they gated.
- **Flow**: the same runs on a time axis, grouped into agent lanes. Zoom with the Fit, plus and
  minus buttons or Ctrl+wheel. Long idle gaps compress behind a hatched band, with a toggle, so
  traces that wait between calls stay readable. Diamonds mark tool calls, and in paid editions
  authorization decisions, including a hatched band for time spent waiting on an approval. Clicking
  a node opens the run.

Above the tree is a **turn summary**: the prompt that started the turn, an excerpt of the last
answer, wall clock, number of calls, tool calls, cost and the first failure if any. Sessions show
one row per turn, so you can jump straight to the right trace. **Analyze with AI** (paid) asks the
configured judge model to explain the trace: flow, cost drivers, errors and improvements.

## Run detail

- A breadcrumb from the root run to this one, and **Previous** / **Next** to step through the trace
  in order.
- Prompt, response, reasoning and tool call panels, plus retrieved context and media when present.
- Score, notes, golden flag, share links, replay, compare, cost comparison and **Open in
  Playground**.
- The subagent runs table lists child calls.

## Live feed

New runs stream in as they are captured. **Pause** holds them without losing the buffer. The feed
follows the project scope.

## Analytics

Spend, runs, error rate, latency percentiles, tokens and mean score for 7, 14 or 30 days, then
breakdown tables by model, agent, end user, project and MCP tool. Each row links into the runs list
with that filter applied.

## Cost and Alerts

Month-to-date spend and limits, with a **View** selector:

- **All projects**: one table with the account row, one row per project and one row per API key,
  each with its spend and inline budget and hard-cap editors.
- **One project**: that project's spend, limits and the API keys scoped to it, with links to its
  runs and analytics.

Below the table: alert channels (webhook, Slack, PagerDuty, email), the weekly digest button and
custom pricing overrides.

## Insights

A written read on the last 7 days: highlights, clickable next steps, and savings from prompt caching
and small-model routing. It follows the project scope, and **Generate now** refreshes it.

## Agents

- **Observed**: every agent name seen in your runs, with runs, cost, errors, first and last seen,
  and a link to its runs. Free in every edition and scoped to the selected project.
- **Registry**: agents with an identity, credentials and delegated authority. This is part of the
  paid agent control plane; see [Pro and Enterprise features](pro-and-enterprise.md).

## Management and system pages

- **Prompts**: a versioned prompt library. The proxy can render a stored prompt for any
  OpenAI-shaped request through the `x-torrix-prompt` header or a `prompt` body field.
- **Datasets and Evals**: golden questions with expected answers, offline scoring of captured runs,
  CSV or JSON import, and judge-based scoring in paid editions.
- **Projects**: create projects, invite members with owner, editor or viewer roles, and set
  per-project budgets and compression.
- **Team**: your projects and roles. Admins also see the account list and an **All projects** table
  with owner, members, month runs and spend, budget and hard cap.
- **API Keys**: create keys with scopes and per-key budgets or caps. Secrets are shown once.
- **Integrations**: one card per way to send data (proxy, SDKs, Claude Code, opencode,
  OpenTelemetry, MCP), each with a **Generate key** button and copyable snippets.
- **Governance**: PII masking in every edition; policies, the review queue, routing rules, SLM
  signals, the audit log and the AI Act report in paid editions.
- **Playground**: chat against any provider from the browser. Each turn is logged as a run and
  labelled with the playground source.
- **SQL console**: admin-only read-only SQL over your runs.
- **Settings**: users, license, SSO (paid), the database engine, sampling, telemetry and the
  update check.

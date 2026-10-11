import type { DbClient } from "../db/client";
import { sqlGet, sqlRun, updateById } from "../db/sql";
import type { AlertSettings } from "../core/domain";
import type { AlertRepository } from "../core/ports";

const SETTINGS_COLUMNS = [
  "user_id",
  "enabled",
  "webhook_url",
  "webhook_secret",
  "pagerduty_routing_key",
  "email_webhook_url",
  "email_webhook_token",
  "email_recipients",
  "budget_usd",
  "hard_cap_usd",
  "last_alert_at",
  "last_alert_level",
  "notify_on_error",
  "anomaly_enabled",
  "anomaly_multiplier",
  "digest_enabled",
  "last_digest_sent_at",
];

function defaultSettings(userId: string): AlertSettings {
  return {
    user_id: userId,
    enabled: 0,
    webhook_url: null,
    webhook_secret: null,
    pagerduty_routing_key: null,
    email_webhook_url: null,
    email_webhook_token: null,
    email_recipients: null,
    budget_usd: null,
    hard_cap_usd: null,
    last_alert_at: null,
    last_alert_level: null,
    notify_on_error: 0,
    anomaly_enabled: 0,
    anomaly_multiplier: 3.0,
    digest_enabled: 0,
    last_digest_sent_at: null,
  };
}

export function createAlertRepository(db: DbClient): AlertRepository {
  return {
    async getByUser(userId: string): Promise<AlertSettings> {
      const row = await sqlGet<AlertSettings>(
        db.engine,
        `SELECT ${SETTINGS_COLUMNS.join(", ")} FROM alert_settings WHERE user_id = ?`,
        [userId],
      );
      if (row) {
        return { ...defaultSettings(userId), ...row };
      }
      return defaultSettings(userId);
    },

    async update(userId: string, fields: Partial<AlertSettings>): Promise<void> {
      const allowed: Partial<AlertSettings> = {};
      for (const key of Object.keys(fields) as (keyof AlertSettings)[]) {
        if (SETTINGS_COLUMNS.includes(key) && key !== "user_id") {
          (allowed as Record<string, unknown>)[key] = fields[key];
        }
      }
      if (!Object.keys(allowed).length) {
        return;
      }
      await sqlRun(db.engine, "INSERT OR IGNORE INTO alert_settings (user_id) VALUES (?)", [userId]);
      await updateById(db.engine, "alert_settings", userId, allowed as Record<string, unknown>, "user_id");
    },

    async touchAlert(userId: string, level: number | null): Promise<void> {
      await updateById(
        db.engine,
        "alert_settings",
        userId,
        { last_alert_at: new Date().toISOString(), last_alert_level: level },
        "user_id",
      );
    },

    async touchDigest(userId: string): Promise<void> {
      await updateById(db.engine, "alert_settings", userId, { last_digest_sent_at: new Date().toISOString() }, "user_id");
    },

    async getAnomalyCooldown(userId: string, model: string): Promise<string | null> {
      const row = await sqlGet<{ last_fired_at: string }>(
        db.engine,
        "SELECT last_fired_at FROM anomaly_cooldowns WHERE user_id = ? AND model = ?",
        [userId, model],
      );
      return row?.last_fired_at ?? null;
    },

    async touchAnomalyCooldown(userId: string, model: string): Promise<void> {
      const now = new Date().toISOString();
      await sqlRun(db.engine, "INSERT OR IGNORE INTO anomaly_cooldowns (user_id, model, last_fired_at) VALUES (?, ?, ?)", [
        userId,
        model,
        now,
      ]);
      await sqlRun(db.engine, "UPDATE anomaly_cooldowns SET last_fired_at = ? WHERE user_id = ? AND model = ?", [now, userId, model]);
    },
  };
}
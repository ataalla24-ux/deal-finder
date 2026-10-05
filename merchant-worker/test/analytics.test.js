import test from "node:test";
import assert from "node:assert/strict";

import {
  analyticsDays,
  sanitizeAnalyticsEvent,
  sanitizeAnalyticsProperties,
} from "../src/index.js";

test("sanitizes an allowed analytics event without retaining free-form values", () => {
  const event = sanitizeAnalyticsEvent({
    eventId: "8d62cd84-2ac0-48c8-88f8-23f0c32769e4",
    name: "deal_opened",
    occurredAt: "2026-08-24T12:00:00.000Z",
    anonymousId: "33af6776-7264-4532-8268-7804bb659a6e",
    platform: "ios",
    appVersion: "1.25",
    build: "57",
    plan: "plus",
    properties: {
      dealId: "omv-sunset-2026",
      category: "Kaffee & Kuchen",
      title: "This must never be stored",
      durationMs: 1234.6,
      fromCache: false,
    },
  }, Date.parse("2026-08-24T12:01:00.000Z"));

  assert.equal(event.name, "deal_opened");
  assert.equal(event.plan, "plus");
  assert.deepEqual(event.properties, {
    category: "kaffeekuchen",
    dealId: "omv-sunset-2026",
    durationMs: 1235,
    fromCache: false,
  });
  assert.equal("title" in event.properties, false);
});

test("rejects unknown events and malformed identifiers", () => {
  assert.equal(sanitizeAnalyticsEvent({
    eventId: "event-0001",
    name: "screen_recording",
    anonymousId: "installation-1",
    platform: "ios",
  }), null);
  assert.equal(sanitizeAnalyticsEvent({
    eventId: "event 0001",
    name: "app_open",
    anonymousId: "installation-1",
    platform: "ios",
  }), null);
  assert.equal(sanitizeAnalyticsEvent({
    eventId: "event-1",
    name: "app_open",
    anonymousId: "",
    platform: "android",
  }), null);
});

test("bounds numeric properties and returns UTC summary days", () => {
  assert.deepEqual(sanitizeAnalyticsProperties({
    durationMs: 999999,
    dealCount: -2,
    count: 10.4,
  }), {
    durationMs: 120000,
    dealCount: 0,
    count: 10,
  });
  assert.deepEqual(
    analyticsDays(3, new Date("2026-01-01T01:00:00.000Z")),
    ["2026-01-01", "2025-12-31", "2025-12-30"],
  );
});

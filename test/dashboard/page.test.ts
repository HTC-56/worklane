import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { testApp } from "../helpers.js";

describe("the dashboard shell on GET /", () => {
  let t: TestApp;
  let tokenApp: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp();
    apps.push(t);

    tokenApp = testApp({ bearerToken: "0123456789abcdef0123" });
    apps.push(tokenApp);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("GET / answers 200 and its content-type header matches text/html", async () => {
    const r = await t.app.inject({ method: "GET", url: "/" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toMatch(/text\/html/);
  });

  it("The body starts with <!doctype html> (case-insensitive) and contains <title>worklane", async () => {
    const r = await t.app.inject({ method: "GET", url: "/" });
    const body = r.body;
    expect(body.toLowerCase().startsWith("<!doctype html")).toBe(true);
    expect(body).toContain("<title>worklane");
  });

  it("The body contains the six panel ids: tiles, bytype, running, dlq, workers, feed", async () => {
    const r = await t.app.inject({ method: "GET", url: "/" });
    const body = r.body;
    expect(body).toContain('id="tiles"');
    expect(body).toContain('id="bytype"');
    expect(body).toContain('id="running"');
    expect(body).toContain('id="dlq"');
    expect(body).toContain('id="workers"');
    expect(body).toContain('id="feed"');
  });

  it("On a token-carrying app, GET / with no Authorization header still answers 200", async () => {
    const r = await tokenApp.app.inject({ method: "GET", url: "/" });
    expect(r.statusCode).toBe(200);
  });

  it("On a token-carrying app, GET /stats with no Authorization header answers 401", async () => {
    const r = await tokenApp.app.inject({ method: "GET", url: "/stats" });
    expect(r.statusCode).toBe(401);
  });
});

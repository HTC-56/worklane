import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { testApp } from "../helpers.js";

describe("HTTP bearer token auth", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp({ bearerToken: "0123456789abcdef0123" });
    apps.push(t);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("GET /jobs with no Authorization header answers 401", async () => {
    const r = await t.app.inject({
      method: "GET",
      url: "/jobs",
    });
    expect(r.statusCode).toBe(401);
  });

  it("GET /jobs with the correct bearer token answers 200", async () => {
    const r = await t.app.inject({
      method: "GET",
      url: "/jobs",
      headers: t.auth,
    });
    expect(r.statusCode).toBe(200);
  });

  it("GET /jobs with a wrong token answers 401", async () => {
    const r = await t.app.inject({
      method: "GET",
      url: "/jobs",
      headers: { authorization: "Bearer wrong-token-here-xx" },
    });
    expect(r.statusCode).toBe(401);
  });

  it("GET /jobs with a non-Bearer auth header answers 401; /healthz is open; no-token app is open", async () => {
    // Non-Bearer form (basic)
    const basic = await t.app.inject({
      method: "GET",
      url: "/jobs",
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(basic.statusCode).toBe(401);

    // /healthz is always open
    const hz = await t.app.inject({
      method: "GET",
      url: "/healthz",
    });
    expect(hz.statusCode).toBe(200);

    // Second app with no token — everything is open
    const noToken = testApp();
    apps.push(noToken);
    const open = await noToken.app.inject({
      method: "GET",
      url: "/jobs",
    });
    expect(open.statusCode).toBe(200);
    await noToken.close();
  });
});

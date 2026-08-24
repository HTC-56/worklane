import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { TestApp } from "../helpers.js";
import { testApp } from "../helpers.js";

import { dashboardHtml } from "../../src/dashboard/index.js";

describe("the dashboard page is self-contained", () => {
  let t: TestApp;
  const apps: TestApp[] = [];

  beforeEach(() => {
    t = testApp();
    apps.push(t);
  });

  afterAll(async () => {
    await Promise.all(apps.map((a) => a.close()));
  });

  it("dashboardHtml() returns a string > 5000 chars starting with <!doctype html", () => {
    const html = dashboardHtml();
    expect(html.length).toBeGreaterThan(5000);
    expect(html.toLowerCase().startsWith("<!doctype html")).toBe(true);
  });

  it("The HTML contains no http:// and no https:// anywhere", () => {
    const html = dashboardHtml();
    expect(html).not.toContain("http://");
    expect(html).not.toContain("https://");
  });

  it("The HTML has no <script src= and no <link elements", () => {
    const html = dashboardHtml();
    // No external script sources
    expect(html).not.toMatch(/<script[^>]*src=/i);
    // No <link> elements at all
    expect(html).not.toMatch(/<link/i);
  });

  it("The HTML has no @import, fonts., react, or vue", () => {
    const html = dashboardHtml();
    expect(html).not.toContain("@import");
    expect(html.toLowerCase()).not.toContain("fonts.");
    expect(html.toLowerCase()).not.toContain("react");
    expect(html.toLowerCase()).not.toContain("vue");
  });

  it("The HTML has inline <style> and <script> blocks, and GET / body matches dashboardHtml()", async () => {
    const html = dashboardHtml();
    expect(html).toContain("<style>");
    expect(html).toContain("<script>");

    const r = await t.app.inject({ method: "GET", url: "/" });
    expect(r.body).toBe(html);
  });
});

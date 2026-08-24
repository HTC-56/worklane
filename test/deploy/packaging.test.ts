import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { loadConfigFile } from "../../src/config.js";

describe("the packaging, proven", () => {
  it("loadConfigFile succeeds on the example config and bearerToken is undefined", () => {
    const config = loadConfigFile("deploy/worklane.example.yaml");
    expect(config.bearerToken).toBeUndefined();
  });

  it("deploy/worklane.service has [Unit], [Service], [Install] and WantedBy=multi-user.target", () => {
    const svc = readFileSync("deploy/worklane.service", "utf8");
    expect(svc).toContain("[Unit]");
    expect(svc).toContain("[Service]");
    expect(svc).toContain("[Install]");
    expect(svc).toContain("WantedBy=multi-user.target");
  });

  it("The service file has ExecStart with dist/server.js and --config, the expected paths, User= and TimeoutStopSec=", () => {
    const svc = readFileSync("deploy/worklane.service", "utf8");
    expect(svc).toMatch(/ExecStart=.*dist\/server\.js/);
    expect(svc).toMatch(/ExecStart=.*--config/);
    expect(svc).toContain("/etc/worklane/worklane.yaml");
    expect(svc).toContain("/opt/worklane");
    expect(svc).toMatch(/^User=/m);
    expect(svc).toMatch(/^TimeoutStopSec=/m);
  });

  it(".github/workflows/ci.yml contains ubuntu-latest, pnpm install, bash scripts/verify.sh and 22", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8");
    expect(ci).toContain("ubuntu-latest");
    expect(ci).toContain("pnpm install");
    expect(ci).toContain("bash scripts/verify.sh");
    expect(ci).toContain("22");
  });

  it("README.md contains ## Quickstart, pnpm install, curl, cancel, and links to docs/PROCESS.md and deploy/worklane.example.yaml", () => {
    const readme = readFileSync("README.md", "utf8");
    expect(readme).toContain("## Quickstart");
    expect(readme).toContain("pnpm install");
    expect(readme).toContain("curl");
    expect(readme).toContain("cancel");
    expect(readme).toContain("docs/PROCESS.md");
    expect(readme).toContain("deploy/worklane.example.yaml");
  });
});

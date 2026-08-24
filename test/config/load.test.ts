import { afterAll, describe, expect, it } from "vitest";
import { ConfigError } from "../../src/errors.js";
import { loadConfigFile, parseYamlSubset, resolveConfig } from "../../src/config.js";
import { scratchDir } from "../helpers.js";

const dir = scratchDir();

afterAll(() => {
  dir.cleanup();
});

describe("parseYamlSubset scalar kinds", () => {
  it("reads a bare string, an integer, a boolean, null, a quoted value with trailing comment, and an empty string", () => {
    const doc = `
name: hello
count: 42
active: true
nothing: null
label: "double quoted" # trailing comment
empty: ""
`.trim();

    const result = parseYamlSubset(doc);

    expect(result["name"]).toBe("hello");
    expect(result["count"]).toBe(42);
    expect(result["count"]).toBeTypeOf("number");
    expect(result["active"]).toBe(true);
    expect(result["nothing"]).toBe(null);
    expect(result["label"]).toBe("double quoted");
    expect(result["empty"]).toBe("");
  });
});

describe("loadConfigFile reads the example config", () => {
  it("returns workerCount 4, httpPort 8080, dbPath ./worklane.sqlite, and leaseDurationMs 30000", () => {
    const config = loadConfigFile("deploy/worklane.example.yaml");

    expect(config.workerCount).toBe(4);
    expect(config.httpPort).toBe(8080);
    expect(config.dbPath).toBe("./worklane.sqlite");
    expect(config.leaseDurationMs).toBe(30000);
  });
});

describe("loadConfigFile rejects unknown keys", () => {
  it("throws ConfigError whose message contains the misspelled key", () => {
    const file = `${dir.path}/bad-key.yaml`;
    require("node:fs").writeFileSync(file, "workerCont: 3\n");

    expect(() => loadConfigFile(file)).toThrow(ConfigError);
    try {
      loadConfigFile(file);
      expect.fail("should have thrown");
    } catch (err) {
      expect((err as Error).message).toContain("workerCont");
    }
  });
});

describe("loadConfigFile rejects invalid values", () => {
  it("throws ConfigError for workerCount: 0 (not a raw ZodError)", () => {
    const file = `${dir.path}/zero-workers.yaml`;
    require("node:fs").writeFileSync(file, "workerCount: 0\n");

    try {
      loadConfigFile(file);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
    }
  });
});

describe("parseYamlSubset rejects non-scalar syntax with line numbers", () => {
  it("throws ConfigError naming the line for indented input, sequences, and inline collections", () => {
    const indentDoc = "key: val\n  bad: line\n";
    try {
      parseYamlSubset(indentDoc);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain("2");
    }

    const seqDoc = "- item: one\n";
    try {
      parseYamlSubset(seqDoc);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain("1");
    }

    const collDoc = "items: { }\n";
    try {
      parseYamlSubset(collDoc);
      expect.fail("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError);
      expect((err as Error).message).toContain("1");
    }
  });
});

describe("resolveConfig resolves source from argv, env, and rejects bad flags", () => {
  it("defaults to built-in, reads from --config and WORKLANE_CONFIG env, and rejects unknown flags", () => {
    const defaults = resolveConfig([], {});
    expect(defaults.source).toBe("built-in defaults");

    const fromArgv = resolveConfig(["--config", "deploy/worklane.example.yaml"], {});
    expect(fromArgv.source).toBe("deploy/worklane.example.yaml");
    expect(fromArgv.config.workerCount).toBe(4);

    const fromEnv = resolveConfig([], { WORKLANE_CONFIG: "deploy/worklane.example.yaml" });
    expect(fromEnv.source).toBe("deploy/worklane.example.yaml");
    expect(fromEnv.config.workerCount).toBe(4);

    expect(() => resolveConfig(["--nope"], {})).toThrow(ConfigError);
  });
});

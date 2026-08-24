import { readFileSync } from "node:fs";
import { ConfigError } from "./errors.js";
import { ConfigSchema, type Config } from "./types.js";

/**
 * SPEC feature 9 asks for a YAML config file. worklane's config is a flat map
 * of scalars, so rather than take a parser dependency for `key: value` this
 * module reads a deliberately small YAML subset:
 *
 *   - one `key: value` pair per line, at column zero;
 *   - `#` comments, blank lines, and a leading `---` document marker;
 *   - scalars only — strings (bare, "double" or 'single' quoted), integers,
 *     floats, `true`/`false`, and `null`/`~`.
 *
 * Anything else — indentation, sequences, inline collections, anchors, block
 * scalars — is a loud error naming the line, never a silent misreading. The
 * subset is documented in README.md so nobody writes a config it cannot read.
 */

const KEY_LINE = /^([A-Za-z_][A-Za-z0-9_]*)[ \t]*:[ \t]*(.*)$/;
const INTEGER = /^[+-]?[0-9]+$/;
const FLOAT = /^[+-]?([0-9]+\.[0-9]*|\.[0-9]+|[0-9]+)([eE][+-]?[0-9]+)?$/;

function fail(source: string, line: number, message: string): never {
  throw new ConfigError(`${source}:${String(line)}: ${message}`);
}

/** Everything after a bare scalar must be blank or a `#` comment. */
function requireTrailingBlank(rest: string, source: string, line: number): void {
  const tail = rest.trim();
  if (tail !== "" && !tail.startsWith("#")) {
    fail(source, line, `unexpected text after the value: ${tail}`);
  }
}

function parseQuoted(raw: string, source: string, line: number): string {
  const quote = raw[0] as '"' | "'";
  let index = 1;
  let out = "";

  while (index < raw.length) {
    const char = raw[index] as string;
    if (quote === '"' && char === "\\") {
      const next = raw[index + 1];
      if (next === undefined) break;
      const escapes: Record<string, string> = {
        n: "\n",
        t: "\t",
        r: "\r",
        "\\": "\\",
        '"': '"',
      };
      const decoded = escapes[next];
      if (decoded === undefined) fail(source, line, `unsupported escape \\${next}`);
      out += decoded;
      index += 2;
      continue;
    }
    if (char === quote) {
      // In single-quoted YAML, '' is a literal quote rather than the end.
      if (quote === "'" && raw[index + 1] === "'") {
        out += "'";
        index += 2;
        continue;
      }
      requireTrailingBlank(raw.slice(index + 1), source, line);
      return out;
    }
    out += char;
    index += 1;
  }

  return fail(source, line, "unterminated quoted string");
}

function parseScalar(raw: string, source: string, line: number): unknown {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') || trimmed.startsWith("'")) {
    return parseQuoted(trimmed, source, line);
  }

  // A bare scalar ends at a comment, which YAML requires be preceded by space.
  const comment = trimmed.search(/(^|[ \t])#/);
  const value = (comment === -1 ? trimmed : trimmed.slice(0, comment)).trim();

  if (value === "" || value === "null" || value === "~") return null;
  if (value === "true") return true;
  if (value === "false") return false;

  if (value.startsWith("[") || value.startsWith("{")) {
    fail(source, line, "inline collections are not supported — scalars only");
  }
  if (value === "|" || value === ">" || value.startsWith("|") || value.startsWith(">")) {
    fail(source, line, "block scalars are not supported — keep the value on one line");
  }
  if (value.startsWith("&") || value.startsWith("*")) {
    fail(source, line, "anchors and aliases are not supported");
  }

  if (INTEGER.test(value)) {
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed)) fail(source, line, `integer out of range: ${value}`);
    return parsed;
  }
  if (FLOAT.test(value)) return Number(value);

  return value;
}

/** Parses the documented YAML subset into a flat object. Throws `ConfigError`. */
export function parseYamlSubset(text: string, source = "<config>"): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i] as string;
    const lineNo = i + 1;
    const trimmed = raw.trim();

    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (trimmed === "---" || trimmed === "...") continue;

    if (/^[ \t]/.test(raw)) {
      fail(source, lineNo, "indented lines are not supported — the config is a flat map");
    }
    if (trimmed === "-" || trimmed.startsWith("- ")) {
      fail(source, lineNo, "sequences are not supported — the config is a flat map");
    }

    const match = KEY_LINE.exec(raw);
    if (!match) fail(source, lineNo, `expected \`key: value\`, got: ${trimmed}`);

    const key = match[1] as string;
    if (Object.prototype.hasOwnProperty.call(out, key)) {
      fail(source, lineNo, `duplicate key: ${key}`);
    }
    out[key] = parseScalar(match[2] as string, source, lineNo);
  }

  return out;
}

/** The config keys, for a typo's error message. */
function knownKeys(): string {
  return Object.keys(ConfigSchema.shape).sort().join(", ");
}

/**
 * Reads a config file and validates it against `ConfigSchema`. Unknown keys are
 * rejected rather than ignored — a typo that silently keeps a default is the
 * worst kind of config bug. Keys left out keep their documented defaults, and
 * `null` means "use the default" so a commented-out value can be spelled.
 */
export function loadConfigFile(path: string): Config {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    throw new ConfigError(`config file not found: ${path}`);
  }

  const raw = parseYamlSubset(text, path);
  for (const key of Object.keys(raw)) {
    if (raw[key] === null) delete raw[key];
  }

  const result = ConfigSchema.strict().safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => {
        const where = issue.path.join(".") || "(root)";
        return `  ${where}: ${issue.message}`;
      })
      .join("\n");
    throw new ConfigError(`invalid config in ${path}:\n${issues}\nknown keys: ${knownKeys()}`);
  }
  return result.data;
}

export interface ResolvedConfig {
  config: Config;
  /** The file the config came from, or `built-in defaults`. */
  source: string;
}

/**
 * How `src/server.ts` decides what to run: `--config <path>` beats
 * `WORKLANE_CONFIG` beats the built-in defaults. An unrecognised flag is an
 * error, so a typo cannot quietly start a server with the wrong settings.
 */
export function resolveConfig(
  argv: readonly string[],
  env: Record<string, string | undefined> = {},
): ResolvedConfig {
  let path: string | undefined;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] as string;
    if (arg === "--config") {
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        throw new ConfigError("--config needs a path, e.g. --config ./worklane.yaml");
      }
      path = next;
      i += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      const value = arg.slice("--config=".length);
      if (value === "") {
        throw new ConfigError("--config needs a path, e.g. --config=./worklane.yaml");
      }
      path = value;
      continue;
    }
    throw new ConfigError(`unrecognised argument: ${arg} (worklane accepts --config <path>)`);
  }

  if (path === undefined) {
    const fromEnv = env["WORKLANE_CONFIG"];
    if (fromEnv !== undefined && fromEnv !== "") path = fromEnv;
  }

  if (path === undefined) {
    return { config: ConfigSchema.parse({}), source: "built-in defaults" };
  }
  return { config: loadConfigFile(path), source: path };
}

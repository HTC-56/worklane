// Test fixture: installs SIGTERM/SIGINT handlers that do nothing, so only
// SIGKILL can end it. argv[2], when given, is a path this writes once the
// handlers are installed — that makes "ready to ignore SIGTERM" observable
// instead of a race against process startup.
import { writeFileSync } from "node:fs";

process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});

const readyPath = process.argv[2];
if (readyPath) writeFileSync(readyPath, "ready");

setInterval(() => {}, 1000);

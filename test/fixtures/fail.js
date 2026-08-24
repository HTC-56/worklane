// Test fixture: writes to stderr and exits non-zero (default code 3).
const code = Number.parseInt(process.argv[2] ?? "3", 10);
process.stderr.write(`boom: failing on purpose with code ${code}\n`);
process.exit(code);

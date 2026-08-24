// Test fixture: writes argv[2] lines of 100 'x' characters, then exits 0.
const lines = Number.parseInt(process.argv[2] ?? "10", 10);
for (let i = 0; i < lines; i++) process.stdout.write("x".repeat(99) + "\n");

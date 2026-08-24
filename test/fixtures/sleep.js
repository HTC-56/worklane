// Test fixture: sleeps for given milliseconds (arg 1) then exits 0
const ms = parseInt(process.argv[2] || "100", 10);
setTimeout(() => process.exit(0), ms);
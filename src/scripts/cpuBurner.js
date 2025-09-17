import crypto from "crypto";

const seconds = Number(process.argv[2] || 60);
const until = Date.now() + seconds * 1000;

let iterations = 0;

// PBKDF2 is CPU-heavy and deterministic; great for a demo.
while (Date.now() < until) {
  crypto.pbkdf2Sync("demo-password", "demo-salt", 250000, 64, "sha512");
  iterations++;
  // Optional tiny yield: comment out if you want even higher CPU
  // if (iterations % 50 === 0) Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 0);
}

console.log(
  JSON.stringify({
    done: true,
    seconds,
    iterations
  })
);

// Exit with success (so parent knows we finished)
process.exit(0);

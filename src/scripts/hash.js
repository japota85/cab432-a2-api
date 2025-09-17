import bcrypt from "bcrypt";

// Usage: node src/scripts/hash.js <plainPassword> [rounds]
const [, , plain = "1234", roundsArg] = process.argv;
const rounds = Number(roundsArg) || 10;

const hash = await bcrypt.hash(plain, rounds);

console.log(`plain=${plain}`);
console.log(`rounds=${rounds}`);
console.log(`hash=${hash}`);

const fs = require("fs");
const path = require("path");
const readline = require("readline");

const INPUT = path.join(process.cwd(), "data", "cms_subset_small.csv");
const OUTPUT = path.join(process.cwd(), "data", "cms_subset_small_2p.csv");

(async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error("Missing input:", INPUT);
    process.exit(1);
  }

  const inStream = fs.createReadStream(INPUT, { encoding: "utf8" });
  const rl = readline.createInterface({ input: inStream, crlfDelay: Infinity });
  const outStream = fs.createWriteStream(OUTPUT, { encoding: "utf8" });

  let header = "";
  let lines = [];
  for await (const line of rl) {
    if (!header) { header = line; continue; }
    if (line.trim()) lines.push(line);
  }

  outStream.write("Year," + header + "\n");

  const mid = Math.floor(lines.length / 2);
  for (let i = 0; i < lines.length; i++) {
    const year = i < mid ? "2023" : "2024"; // pseudo early vs late
    outStream.write(year + "," + lines[i] + "\n");
  }

  outStream.end();
  console.log("✅ Wrote:", OUTPUT);
  console.log("Rows:", lines.length);
})();

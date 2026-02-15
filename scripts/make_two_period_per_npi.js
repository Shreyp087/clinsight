const fs = require("fs");
const path = require("path");
const readline = require("readline");

const INPUT = path.join(process.cwd(), "data", "cms_subset_small.csv");
const OUTPUT = path.join(process.cwd(), "data", "cms_subset_small_2p.csv");

function parseCSVLine(line) {
  // Fast CSV split that respects quotes
  const out = [];
  let cur = "";
  let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      // handle escaped quotes ""
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (ch === "," && !inQ) {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

(async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error("Missing input:", INPUT);
    process.exit(1);
  }

  const inStream = fs.createReadStream(INPUT, { encoding: "utf8" });
  const rl = readline.createInterface({ input: inStream, crlfDelay: Infinity });

  let headerLine = "";
  let header = [];
  let npiIdx = -1;

  // Group rows by NPI
  const byNpi = new Map(); // npi -> array of raw lines

  for await (const line of rl) {
    if (!headerLine) {
      headerLine = line;
      header = parseCSVLine(line);
      npiIdx = header.indexOf("Rndrng_NPI");
      if (npiIdx === -1) {
        console.error("Rndrng_NPI column not found in header.");
        process.exit(1);
      }
      continue;
    }
    if (!line.trim()) continue;

    const cols = parseCSVLine(line);
    const npi = cols[npiIdx];
    if (!byNpi.has(npi)) byNpi.set(npi, []);
    byNpi.get(npi).push(line);
  }

  const outStream = fs.createWriteStream(OUTPUT, { encoding: "utf8" });
  outStream.write("Year," + headerLine + "\n");

  let written = 0;

  for (const [npi, lines] of byNpi.entries()) {
    // Split THIS NPI's lines into two periods
    const mid = Math.floor(lines.length / 2) || 1;

    for (let i = 0; i < lines.length; i++) {
      const year = i < mid ? "2023" : "2024";
      outStream.write(year + "," + lines[i] + "\n");
      written++;
    }
  }

  outStream.end();
  console.log("✅ Wrote:", OUTPUT);
  console.log("NPIs:", byNpi.size, "Rows written:", written);
})();


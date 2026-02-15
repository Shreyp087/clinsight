const fs = require("fs");
const path = require("path");
const readline = require("readline");

const INPUT = path.join(process.cwd(), "data", "cms_subset.csv"); // your big file
const OUTPUT = path.join(process.cwd(), "data", "cms_subset_small.csv");

// tune these
const MAX_LINES = 200000; // ~200k rows is usually plenty; reduce if needed
const FILTER_PROVIDER_TYPE = ""; // e.g. "Cardiology" or "" to disable

(async function main() {
  if (!fs.existsSync(INPUT)) {
    console.error("Input not found:", INPUT);
    process.exit(1);
  }

  const inStream = fs.createReadStream(INPUT, { encoding: "utf8" });
  const rl = readline.createInterface({ input: inStream, crlfDelay: Infinity });
  const outStream = fs.createWriteStream(OUTPUT, { encoding: "utf8" });

  let header = "";
  let count = 0;
  let kept = 0;

  for await (const line of rl) {
    if (!header) {
      header = line;
      outStream.write(header + "\n");
      continue;
    }

    count++;
    if (count > MAX_LINES) break;

    // Optional filter by provider type (column exists in your dataset)
    if (FILTER_PROVIDER_TYPE) {
      // crude but fast: check substring match
      if (!line.includes(FILTER_PROVIDER_TYPE)) continue;
    }

    outStream.write(line + "\n");
    kept++;
  }

  outStream.end();
  console.log("Wrote:", OUTPUT);
  console.log("Read lines:", count, "Kept:", kept);
})();

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { z } from "zod";
import type { CmsRow } from "./types";

/**
 * Loader for CMS "Medicare Physician & Other Practitioners — by Provider and Service"
 * Using a hackathon-friendly 2-period file (Year column injected):
 *
 * Expected headers in cms_subset_small_2p.csv:
 * - Year
 * - Rndrng_NPI
 * - HCPCS_Cd
 * - Place_Of_Srvc
 * - Tot_Srvcs
 * - Avg_Mdcr_Alowd_Amt
 */

const RowSchema = z.object({
  Year: z.coerce.number().int(),
  Rndrng_NPI: z.coerce.string().min(1),
  HCPCS_Cd: z.coerce.string().min(1),
  Place_Of_Srvc: z.coerce.string().min(1),
  Tot_Srvcs: z.coerce.number(),
  Avg_Mdcr_Alowd_Amt: z.coerce.number(),
});

export function loadCmsSubset(): CmsRow[] {
  const filePath = path.join(process.cwd(), "data", "cms_subset_small_2p.csv");

  if (!fs.existsSync(filePath)) {
    throw new Error(
      `cms_subset_small_2p.csv not found at: ${filePath}. Generate it using scripts/make_two_period_subset.js`
    );
  }

  const content = fs.readFileSync(filePath, "utf8");

  const records = parse(content, {
    columns: true,
    skip_empty_lines: true,
    trim: true,
    bom: true,
    relax_column_count: true,
  }) as Record<string, unknown>[];

  return records.map((r) => {
    const parsed = RowSchema.parse(r);

    return {
      npi: parsed.Rndrng_NPI,
      year: parsed.Year,
      hcpcs_code: parsed.HCPCS_Cd,
      place_of_service: parsed.Place_Of_Srvc,
      line_srvc_cnt: parsed.Tot_Srvcs,
      average_Medicare_allowed_amt: parsed.Avg_Mdcr_Alowd_Amt,
    };
  });
}

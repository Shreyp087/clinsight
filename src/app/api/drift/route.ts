import { NextResponse } from "next/server";
import { loadCmsSubset } from "@/lib/cmsLoader";
import { computeDriftForNpi, listNpis } from "@/lib/driftEngine";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const npi = searchParams.get("npi");

    const rows = loadCmsSubset();

    // Quick sanity logs (shows in terminal)
    console.log("Loaded rows:", rows.length);
    console.log("Sample row:", rows[0]);

    if (!npi) {
      return NextResponse.json({ npis: listNpis(rows) });
    }

    return NextResponse.json(computeDriftForNpi(rows, npi));
  } catch (err: any) {
    console.error("API /api/drift error:", err);
    return NextResponse.json(
      {
        error: true,
        message: err?.message ?? "Unknown error",
        stack: err?.stack ?? null,
      },
      { status: 500 }
    );
  }
}

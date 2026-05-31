import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const csv: string | undefined = body?.csv;
    const sensitivity: string | undefined = body?.sensitivity;
    if (!csv) {
      return new NextResponse("Missing 'csv' in request body", { status: 400 });
    }

    const tmpDir = os.tmpdir();
    const inPath = path.join(tmpDir, `flagly_upload_${Date.now()}.csv`);
    const outPath = path.join(tmpDir, `flagly_scored_${Date.now()}.csv`);

    fs.writeFileSync(inPath, csv, "utf8");

    // fraud_detector.py lives at the repository root. The Next.js app runs from
    // the `flagly` folder, so check the current working dir then fall back
    // to the parent directory where the script actually resides.
    let scriptPath = path.resolve(process.cwd(), "fraud_detector.py");
    if (!fs.existsSync(scriptPath)) {
      const parentPath = path.resolve(process.cwd(), "..", "fraud_detector.py");
      if (fs.existsSync(parentPath)) {
        scriptPath = parentPath;
      }
    }
    const pythonBin = process.env.PYTHON || process.env.PYTHON3 || "python3";

    try {
      // Capture stdout/stderr so we can return helpful errors to the client
      const args = [scriptPath, inPath, outPath];
      if (sensitivity) args.push(String(sensitivity));
      const output = execFileSync(pythonBin, args, {
        cwd: process.cwd(),
        timeout: 120000,
      });
    } catch (err: any) {
      const msg = err?.stderr?.toString?.() || err?.message || String(err);
      return new NextResponse(`Python scoring failed: ${msg}`, { status: 500 });
    }

    const outCsv = fs.readFileSync(outPath, "utf8");

    // cleanup temp files
    try {
      fs.unlinkSync(inPath);
      fs.unlinkSync(outPath);
    } catch (_) {
      // ignore cleanup errors
    }

    return new NextResponse(outCsv, {
      status: 200,
      headers: { "Content-Type": "text/csv; charset=utf-8" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return new NextResponse(`Server error: ${msg}`, { status: 500 });
  }
}

export const runtime = "nodejs";

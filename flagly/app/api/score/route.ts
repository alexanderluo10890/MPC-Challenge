import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import { NextResponse } from "next/server";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { csv?: unknown; sensitivity?: unknown };
    const csv = typeof body.csv === "string" ? body.csv : undefined;
    const sensitivity =
      typeof body.sensitivity === "string" ? body.sensitivity : undefined;
    if (!csv) {
      return new NextResponse("Missing 'csv' in request body", { status: 400 });
    }

    const tmpDir = os.tmpdir();
    const inPath = path.join(tmpDir, `fraudfrog_upload_${Date.now()}.csv`);
    const outPath = path.join(tmpDir, `fraudfrog_scored_${Date.now()}.csv`);

    fs.writeFileSync(inPath, csv, "utf8");

    // fraud_detector.py lives at the repository root. The Next.js app runs from
    // the `flagly` folder, so check the current working dir then fall back
    // to the parent directory where the script actually resides.
    let scriptPath = path.resolve(
      /* turbopackIgnore: true */ process.cwd(),
      "fraud_detector.py",
    );
    if (!fs.existsSync(scriptPath)) {
      const parentPath = path.resolve(
        /* turbopackIgnore: true */ process.cwd(),
        "..",
        "fraud_detector.py",
      );
      if (fs.existsSync(parentPath)) {
        scriptPath = parentPath;
      }
    }
    // Try to locate a Python executable that has pandas available. This
    // helps avoid `ModuleNotFoundError: No module named 'pandas'` when the
    // system python differs from a project virtualenv.
    const tried: string[] = [];
    const candidateList = [
      process.env.PYTHON,
      process.env.PYTHON3,
      path.resolve(process.cwd(), ".venv", "bin", "python"),
      path.resolve(process.cwd(), "..", ".venv", "bin", "python"),
      "python3",
      "python",
    ];

    function unique(xs: Array<string | undefined>) {
      const seen = new Set<string>();
      return xs.filter((x): x is string => {
        if (!x) return false;
        if (seen.has(x)) return false;
        seen.add(x);
        return true;
      });
    }

    const candidates = unique(candidateList);
    let pythonBin: string | undefined;
    const probeErrors: string[] = [];
    for (const c of candidates) {
      try {
        // quick check: can we import pandas with this python?
        execFileSync(c, ["-c", "import pandas; print(pandas.__version__)"], {
          timeout: 5000,
        });
        pythonBin = c;
        break;
      } catch (err) {
        const stderr =
          typeof err === "object" && err !== null && "stderr" in err
            ? (err as { stderr?: Buffer | string }).stderr
            : undefined;
        const msg = stderr?.toString() || (err instanceof Error ? err.message : String(err));
        probeErrors.push(`${c}: ${msg}`);
        tried.push(c);
      }
    }

    if (!pythonBin) {
      return new NextResponse(
        `Python scoring failed: no python with 'pandas' found. Tried: ${tried.join(", ")}. Probe errors: ${probeErrors.join(" | ")}`,
        { status: 500 },
      );
    }

    try {
      // Run the detector with the verified python
      const args = [scriptPath, inPath, outPath];
      if (sensitivity) args.push(String(sensitivity));
      execFileSync(pythonBin, args, {
        cwd: process.cwd(),
        timeout: 120000,
      });
    } catch (err) {
      const stderr =
        typeof err === "object" && err !== null && "stderr" in err
          ? (err as { stderr?: Buffer | string }).stderr
          : undefined;
      const msg =
        stderr?.toString() || (err instanceof Error ? err.message : String(err));
      return new NextResponse(`Python scoring failed: ${msg}`, { status: 500 });
    }

    const outCsv = fs.readFileSync(outPath, "utf8");

    // cleanup temp files
    try {
      fs.unlinkSync(inPath);
      fs.unlinkSync(outPath);
    } catch {
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

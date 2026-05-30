"use client";

import { useState, useRef, DragEvent } from "react";

export default function UploadPage() {
  const [file, setFile] = useState<File | null>(null);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    const dropped = e.dataTransfer.files[0];
    if (dropped?.name.endsWith(".csv")) setFile(dropped);
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const selected = e.target.files?.[0];
    if (selected) setFile(selected);
  }

  function handleRemove() {
    setFile(null);
    if (inputRef.current) inputRef.current.value = "";
  }

  function formatBytes(bytes: number) {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  return (
    <main className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-xl">

        {/* Header */}
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-2 mb-6">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-orange-500 shadow-md shadow-orange-500/20">
              <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="currentColor">
                <rect x="4" y="2" width="2.2" height="20" rx="1.1" />
                <path d="M6.2 2.5 L20 7.5 L6.2 12.5 Z" />
              </svg>
            </div>
            <span className="text-white font-bold text-lg tracking-tight">Flagly</span>
          </div>

          <h1 className="text-3xl font-bold text-white tracking-tight">
            Welcome back
          </h1>
          <p className="text-slate-400 mt-2 text-sm">
            Upload your transaction file and we'll scan it for suspicious activity.
          </p>
        </div>

        {/* Card */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl p-8 shadow-2xl">

          {/* Drop zone */}
          <div
            onClick={() => !file && inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
            className={`
              rounded-xl border-2 border-dashed transition cursor-pointer
              flex flex-col items-center justify-center gap-3 py-12 px-6 text-center
              ${file
                ? "border-orange-500/40 bg-orange-500/5 cursor-default"
                : dragging
                  ? "border-orange-400 bg-orange-500/10"
                  : "border-slate-700 hover:border-slate-500 hover:bg-slate-800/50"
              }
            `}
          >
            {file ? (
              /* File preview */
              <>
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-orange-500/10 border border-orange-500/20">
                  <svg className="w-6 h-6 text-orange-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
                  </svg>
                </div>
                <div>
                  <p className="text-white font-medium text-sm">{file.name}</p>
                  <p className="text-slate-500 text-xs mt-0.5">{formatBytes(file.size)}</p>
                </div>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); handleRemove(); }}
                  className="text-xs text-slate-500 hover:text-slate-300 transition underline underline-offset-2"
                >
                  Remove file
                </button>
              </>
            ) : (
              /* Empty state */
              <>
                <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-slate-800 border border-slate-700">
                  <svg className="w-6 h-6 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                  </svg>
                </div>
                <div>
                  <p className="text-slate-300 text-sm font-medium">
                    {dragging ? "Drop your file here" : "Drag & drop your CSV file"}
                  </p>
                  <p className="text-slate-500 text-xs mt-1">or click to browse — .csv files only</p>
                </div>
              </>
            )}
          </div>

          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            className="hidden"
            onChange={handleFileChange}
          />

          {/* Analyse button */}
          <button
            type="button"
            disabled={!file}
            className="mt-5 w-full bg-orange-500 hover:bg-orange-400 disabled:bg-slate-800 disabled:text-slate-600 disabled:cursor-not-allowed text-white font-semibold rounded-lg py-2.5 text-sm transition focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2 focus:ring-offset-slate-900"
          >
            Analyse Transactions
          </button>
        </div>

        <p className="text-center text-xs text-slate-600 mt-6">
          Authorized personnel only. All access is monitored and logged.
        </p>
      </div>
    </main>
  );
}

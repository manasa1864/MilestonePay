/**
 * Reads the text of a resume in the browser so clients can search profiles by keywords
 * that appear in resumes.
 *
 *  - Text PDFs: read directly with pdf.js.
 *  - Scanned / image-only PDFs: each page is rendered and read with OCR (Tesseract).
 *  - Word .docx: read with mammoth.  Old .doc files can't be read in the browser.
 *  - Images (png/jpg): OCR.
 *
 * The heavy libraries are loaded only when a resume is actually chosen.
 */

export const MAX_INDEXED_CHARS = 20_000;
const MAX_OCR_PAGES = 4;

export type ResumeScan = {
  text: string;
  method: "pdf-text" | "ocr" | "docx" | "unsupported";
  pages: number;
};

type Progress = (message: string) => void;

const clean = (s: string) => s.replace(/\u0000/g, " ").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
const wordCount = (s: string) => (s.match(/[\p{L}\p{N}]{2,}/gu) ?? []).length;

async function readBuffer(file: Blob) {
  return await file.arrayBuffer();
}

async function ocrCanvas(canvas: HTMLCanvasElement, onProgress?: Progress, label = "Scanning"): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  const worker = await createWorker("eng", 1, {
    logger: (m: { status: string; progress: number }) => {
      if (m.status === "recognizing text") onProgress?.(`${label} ${Math.round(m.progress * 100)}%`);
      else if (m.status.includes("loading")) onProgress?.("Loading the text reader (first time only)");
    },
  });
  try {
    const { data } = await worker.recognize(canvas);
    return data.text;
  } finally {
    await worker.terminate();
  }
}

async function scanPdf(buffer: ArrayBuffer, onProgress?: Progress): Promise<ResumeScan> {
  const pdfjs = await import("pdfjs-dist");
  const workerUrl = (await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const doc = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;

  onProgress?.("Reading text");
  let text = "";
  for (let i = 1; i <= doc.numPages && text.length < MAX_INDEXED_CHARS * 2; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => ("str" in it ? it.str : "")).join(" ") + "\n";
  }
  if (wordCount(text) >= 25) return { text: clean(text), method: "pdf-text", pages: doc.numPages };

  // Almost no selectable text: it's a scan. Render the pages and OCR them.
  let out = "";
  const pages = Math.min(doc.numPages, MAX_OCR_PAGES);
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i);
    const viewport = page.getViewport({ scale: 2 });
    const canvas = document.createElement("canvas");
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    await page.render({ canvasContext: canvas.getContext("2d")!, viewport }).promise;
    out += (await ocrCanvas(canvas, onProgress, `Scanning page ${i} of ${pages}`)) + "\n";
  }
  return { text: clean(out), method: "ocr", pages: doc.numPages };
}

async function scanImage(file: Blob, onProgress?: Progress): Promise<ResumeScan> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0);
  return { text: clean(await ocrCanvas(canvas, onProgress)), method: "ocr", pages: 1 };
}

async function scanDocx(buffer: ArrayBuffer): Promise<ResumeScan> {
  const mammoth = await import("mammoth");
  const { value } = await mammoth.extractRawText({ arrayBuffer: buffer });
  return { text: clean(value), method: "docx", pages: 1 };
}

export async function scanResume(file: Blob & { name?: string }, onProgress?: Progress): Promise<ResumeScan> {
  const name = (file.name ?? "").toLowerCase();
  const type = file.type;
  try {
    let scan: ResumeScan;
    if (type === "application/pdf" || name.endsWith(".pdf")) scan = await scanPdf(await readBuffer(file), onProgress);
    else if (name.endsWith(".docx") || type.includes("wordprocessingml")) scan = await scanDocx(await readBuffer(file));
    else if (type.startsWith("image/")) scan = await scanImage(file, onProgress);
    else return { text: "", method: "unsupported", pages: 0 };
    return { ...scan, text: scan.text.slice(0, MAX_INDEXED_CHARS) };
  } catch (e) {
    console.warn("Resume scan failed", e);
    throw new Error("Couldn't read this file's text. You can still upload it; clients just won't find you by words inside it.");
  }
}

/** Shows where a search matched inside a longer text. */
export function snippetAround(text: string, terms: string[], radius = 60): string {
  const lower = text.toLowerCase();
  let at = -1;
  let hit = "";
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i >= 0 && (at < 0 || i < at)) { at = i; hit = t; }
  }
  if (at < 0) return "";
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + hit.length + radius);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "…" : ""}`;
}

export const searchTerms = (q: string) => q.toLowerCase().split(/[\s,;]+/).map((t) => t.trim()).filter((t) => t.length >= 2);

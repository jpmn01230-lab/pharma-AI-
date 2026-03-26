import * as pdfjsLib from "pdfjs-dist";

// Point the PDF.js worker to the bundled worker file
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

/**
 * Extract plain text from a File object.
 * Supports: PDF, TXT, CSV, DOCX (basic XML extraction).
 */
export async function extractText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";

  if (ext === "pdf") {
    return extractPdf(file);
  }

  if (ext === "txt" || ext === "csv") {
    return file.text();
  }

  if (ext === "docx") {
    return extractDocx(file);
  }

  // Fallback: try to read as plain text
  try {
    return file.text();
  } catch {
    return `[Could not extract text from ${file.name}]`;
  }
}

async function extractPdf(file: File): Promise<string> {
  const arrayBuffer = await file.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  const parts: string[] = [];

  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items
      .map((item: unknown) => ("str" in (item as object) ? (item as { str: string }).str : ""))
      .join(" ");
    parts.push(pageText);
  }

  return parts.join("\n\n");
}

async function extractDocx(file: File): Promise<string> {
  // DOCX is a ZIP; extract the word/document.xml text content
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const xmlFile = zip.file("word/document.xml");
  if (!xmlFile) return `[No text found in ${file.name}]`;

  const xml = await xmlFile.async("text");
  // Strip all XML tags and collapse whitespace
  return xml
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

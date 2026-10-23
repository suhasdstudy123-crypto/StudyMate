import { api, ApiError, errorFromResponse } from "@/lib/api";

/*
  Everything the frontend knows about uploaded files (materials).

    listMaterials(courseId)     GET    /api/courses/{id}/materials
    uploadMaterial(courseId, f) POST   /api/courses/{id}/materials   (multipart)
    renameMaterial(id, title)   PATCH  /api/materials/{id}
    retryMaterial(id)           POST   /api/materials/{id}/retry
    retryFailedPages(id)        POST   /api/materials/{id}/vision/retry
    getVisionStatus()           GET    /api/vision/status     (is the image reader working?)
    deleteMaterial(id)          DELETE /api/materials/{id}
    listPages(id)               GET    /api/materials/{id}/pages
    getPage(id, n)              GET    /api/materials/{id}/pages/{n}
    fileUrl(id)                 the PDF itself, opened in a new tab
    pageImageUrl(id, n)         the saved picture of page n (pages the image reader reads)
*/

/** One file, matching MaterialSummary in backend/app/schemas.py. */
export type Material = {
  id: string;
  course_id: string;
  title: string;
  original_filename: string;
  file_size: number;
  page_count: number | null;
  pages_processed: number;
  status: "pending" | "processing" | "ready" | "failed";
  error_message: string | null;
  chunk_count: number;
  table_count: number;
  vision_page_count: number;
  created_at: string;
  updated_at: string;
  processing_mode: "smart" | "thorough";
  vision_waiting_count: number;
  vision_done_count: number;
  vision_failed_count: number;
};

/** smart = only pages with pictures go to the image reader; thorough = every page */
export type ProcessingMode = "smart" | "thorough";

/** What the image reader has done with a page (document_pages.vision_status). */
export type VisionStatus = "none" | "pending" | "processing" | "done" | "failed";

export type PageSummary = {
  page_number: number;
  char_count: number;
  table_count: number;
  image_count: number;
  drawing_count: number;
  math_symbol_count: number;
  needs_vision: boolean;
  vision_status: VisionStatus;
  vision_error: string | null;
  has_image: boolean;
  chunk_count: number;
};

export type Chunk = {
  id: string;
  chunk_index: number;
  page_number: number;
  chunk_type: "text" | "table" | "diagram";
  /** pdf_text = exact, from the PDF; vision = written by the image reader */
  source: "pdf_text" | "vision";
  content: string;
  token_count: number | null;
};

export type PageDetail = { page: PageSummary; chunks: Chunk[] };

// Same limit as MAX_UPLOAD_MB in backend/app/config.py. Checked here first
// so a 200 MB file is refused instantly instead of after a long upload.
export const MAX_UPLOAD_MB = 50;

export const isWorking = (m: Material) => m.status === "pending" || m.status === "processing";

/** The text is searchable, but some page pictures are still waiting for the image reader. */
export const isReadingPictures = (m: Material) => m.status === "ready" && m.vision_waiting_count > 0;

/** GET /vision/status: matches VisionStatus in backend/app/schemas.py */
export type ReaderStatus = {
  status: "ok" | "paused" | "off" | "error";
  message: string | null;
  paused_until: string | null; // ISO time (UTC); shown in the student's local time
};

export function getVisionStatus() {
  return api<ReaderStatus>("/vision/status");
}

export function retryFailedPages(id: string) {
  return api<Material>(`/materials/${id}/vision/retry`, { method: "POST" });
}

export function listMaterials(courseId: string) {
  return api<Material[]>(`/courses/${courseId}/materials`);
}

export function renameMaterial(id: string, title: string) {
  return api<Material>(`/materials/${id}`, { method: "PATCH", body: { title } });
}

export function retryMaterial(id: string) {
  return api<Material>(`/materials/${id}/retry`, { method: "POST" });
}

export function deleteMaterial(id: string) {
  return api<void>(`/materials/${id}`, { method: "DELETE" });
}

export function listPages(id: string) {
  return api<PageSummary[]>(`/materials/${id}/pages`);
}

export function getPage(id: string, page: number) {
  return api<PageDetail>(`/materials/${id}/pages/${page}`);
}

export const fileUrl = (id: string) => `/api/materials/${id}/file`;

// Used as <img src>. The browser sends the login cookie with it (same origin
// through the /api rewrite), so the backend's owner check still applies.
export const pageImageUrl = (id: string, page: number) => `/api/materials/${id}/pages/${page}/image`;

/*
  Upload with a progress bar.

  Why XMLHttpRequest and not fetch? fetch() can't report how much of the
  REQUEST body has been sent, so there'd be no "45% uploaded". The older
  XMLHttpRequest has xhr.upload.onprogress, which fires as bytes leave the
  browser. Everything else (cookie, /api forwarder, error messages) works
  the same as api().

  The body is FormData: the browser builds a multipart/form-data request
  (the file's bytes plus its name) and sets the Content-Type header with
  the boundary itself, so we must NOT set Content-Type by hand.

  Returns the promise of the created material, plus abort() to cancel.
*/
export function uploadMaterial(
  courseId: string,
  file: File,
  mode: ProcessingMode,
  onProgress: (fraction: number) => void,
): { promise: Promise<Material>; abort: () => void } {
  const xhr = new XMLHttpRequest();
  const promise = new Promise<Material>((resolve, reject) => {
    xhr.open("POST", `/api/courses/${courseId}/materials`);
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress(e.loaded / e.total);
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.response as Material);
      else reject(errorFromResponse(xhr.status, xhr.response));
    };
    xhr.onerror = () => reject(new ApiError(0, "Couldn't reach StudyMate. Check your connection and try again."));
    xhr.onabort = () => reject(new ApiError(-1, "Upload cancelled."));

    const form = new FormData();
    form.append("file", file); // "file" = the parameter name in upload_material()
    form.append("mode", mode); // a second form field next to the file
    xhr.send(form);
  });
  return { promise, abort: () => xhr.abort() };
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

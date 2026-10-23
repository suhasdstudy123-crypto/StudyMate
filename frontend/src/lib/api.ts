/*
  One small helper for every call to the backend.
  It always goes through /api (the forwarder in next.config.ts), sends and
  receives JSON, and turns failures into an ApiError with a readable message.
*/

export type User = {
  id: string;
  name: string;
  email: string;
  role: "student" | "admin";
  is_active: boolean;
  created_at: string;
};

export class ApiError extends Error {
  status: number;
  /** Per-field messages from FastAPI's 422 validation errors, e.g. { email: "..." } */
  fieldErrors: Record<string, string>;

  constructor(status: number, message: string, fieldErrors: Record<string, string> = {}) {
    super(message);
    this.status = status;
    this.fieldErrors = fieldErrors;
  }
}

// FastAPI error bodies look like either
//   { "detail": "Invalid email or password" }                      (our HTTPException)
//   { "detail": [{ "loc": ["body","email"], "msg": "..." }, ...] } (422 validation)
type ErrorBody = { detail?: string | { loc?: (string | number)[]; msg?: string }[] };

export async function api<T>(path: string, options: { method?: string; body?: unknown } = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? "GET",
      headers: options.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
      // Same origin, so the browser attaches the httpOnly login cookie itself.
      // JavaScript never sees or stores the token.
      credentials: "same-origin",
    });
  } catch {
    // fetch only throws when there's no response at all (server down, offline)
    throw new ApiError(0, "Couldn't reach StudyMate. Check your connection and try again.");
  }

  if (res.status === 204) return undefined as T; // e.g. logout: no body

  const data = (await res.json().catch(() => ({}))) as ErrorBody & T;
  if (res.ok) return data as T;
  throw errorFromResponse(res.status, data);
}

/*
  Turns a failed response into an ApiError with a readable message.
  Shared by api() above and by uploads (lib/materials.ts), which use
  XMLHttpRequest instead of fetch to get upload progress.
*/
export function errorFromResponse(status: number, data: unknown): ApiError {
  // The forwarder answers 500 with no JSON when the backend isn't running
  if (status >= 500) {
    return new ApiError(status, "StudyMate's server is having trouble. Try again in a moment.");
  }
  const detail = (data as ErrorBody | null)?.detail;
  if (Array.isArray(detail)) {
    const fieldErrors: Record<string, string> = {};
    for (const item of detail) {
      const field = String(item.loc?.at(-1) ?? "form");
      fieldErrors[field] ??= (item.msg ?? "Invalid value").replace(/^Value error, /, "");
    }
    return new ApiError(status, "Please fix the highlighted fields.", fieldErrors);
  }
  return new ApiError(status, detail ?? "Something went wrong. Please try again.");
}

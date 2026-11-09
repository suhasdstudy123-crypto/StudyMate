import { api, ApiError, errorFromResponse } from "@/lib/api";

/*
  The chat (Stage 7): talks to backend/app/routers/chat.py.

  Normal JSON calls go through api(). Asking a question is different: the
  answer comes back as a STREAM of Server-Sent Events, so askQuestion()
  reads the response body piece by piece and calls a handler per event:

    status  -> "searching your notes"
    sources -> the numbered passages [1]..[8] (the sources panel fills)
    delta   -> the next piece of the answer text (appended as it arrives)
    done    -> the final saved answer (ids, status, which passages were cited)
    error   -> what went wrong (quota used up, Google busy, ...)
*/

export type ChatSource = {
  /** the number used in the answer: [n] */
  n: number;
  cited: boolean;
  chunk_id: string;
  material_id: string;
  material_title: string;
  page_number: number;
  chunk_type: "text" | "table" | "diagram";
  source: "pdf_text" | "vision";
  content: string;
  similarity: number | null;
};

export type AnswerStatus = "answered" | "not_in_notes" | "stopped";

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  status: AnswerStatus | null;
  model: string | null;
  /** questions only: the rewritten follow-up we searched with */
  search_query: string | null;
  sources: ChatSource[];
};

export type ChatSession = {
  id: string;
  course_id: string | null;
  course_name: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
  message_count: number;
};

export type ChatSessionDetail = ChatSession & { messages: ChatMessage[] };

export type ChatStatus = {
  status: "ok" | "paused" | "off";
  /** the model the next answer will most likely use */
  model: string | null;
  /** CHAT_MODEL on the server: if `model` differs, the fallback is answering */
  main_model: string;
  message: string | null;
  available_at: string | null;
};

// Same limit as MAX_QUESTION_CHARS in backend/app/schemas.py.
export const MAX_QUESTION_CHARS = 2000;

export const listSessions = (courseId?: string) =>
  api<ChatSession[]>(`/chat/sessions${courseId ? `?course_id=${courseId}` : ""}`);
export const getSession = (id: string) => api<ChatSessionDetail>(`/chat/sessions/${id}`);
export const createSession = (courseId: string) =>
  api<ChatSession>("/chat/sessions", { method: "POST", body: { course_id: courseId } });
export const deleteSession = (id: string) => api<void>(`/chat/sessions/${id}`, { method: "DELETE" });
export const getChatStatus = () => api<ChatStatus>("/chat/status");
/** Specific starter questions built from the course's own headings */
export const getSuggestions = (courseId: string) =>
  api<{ suggestions: string[] }>(`/chat/suggestions?course_id=${courseId}`).then((r) => r.suggestions);

/** "gemini-3.5-flash-lite" -> "Gemini 3.5 Flash-Lite" (shown under each answer) */
export function modelLabel(model: string | null): string | null {
  if (!model) return null;
  return model
    .split("-")
    .map((w) => (/^\d/.test(w) ? w : w[0].toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/ Lite\b/, "-Lite");
}

export type DoneEvent = {
  question_id: string;
  message_id: string;
  status: AnswerStatus;
  model: string | null;
  text: string;
  cited: number[];
};

export type ErrorEvent = {
  reason: "quota" | "busy" | "setup" | "failed";
  message: string;
  available_at: string | null;
};

export type StreamHandlers = {
  onStatus?: (step: string) => void;
  onSources: (data: { search_query: string | null; mode: "hybrid" | "keywords"; passages: ChatSource[] }) => void;
  onDelta: (text: string) => void;
  onDone: (data: DoneEvent) => void;
  onError: (data: ErrorEvent) => void;
};

/*
  POST the question and read the event stream.
  fetch() gives the body as a ReadableStream of bytes; we decode the bytes to
  text, collect it in a buffer, and cut it at every blank line ("\n\n"),
  which is where one SSE event ends. Pressing Stop aborts the request
  (AbortSignal); the backend notices and keeps the part already shown.
*/
export async function askQuestion(
  sessionId: string,
  question: string,
  handlers: StreamHandlers,
  signal: AbortSignal,
): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api/chat/sessions/${sessionId}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
      body: JSON.stringify({ question }),
      credentials: "same-origin",
      signal,
    });
  } catch (err) {
    if (signal.aborted) throw err;
    throw new ApiError(0, "Couldn't reach StudyMate. Check your connection and try again.");
  }
  // 404 / 409 / 422 / 503 happen BEFORE the stream starts: normal JSON errors.
  if (!res.ok || !res.body) {
    throw errorFromResponse(res.status, await res.json().catch(() => ({})));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finished = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) !== -1) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      let event = "message";
      let data = "";
      for (const line of block.split("\n")) {
        if (line.startsWith("event: ")) event = line.slice(7);
        else if (line.startsWith("data: ")) data += line.slice(6);
      }
      if (!data) continue;
      const payload = JSON.parse(data);
      if (event === "status") handlers.onStatus?.(payload.step);
      else if (event === "sources") handlers.onSources(payload);
      else if (event === "delta") handlers.onDelta(payload.text);
      else if (event === "done") {
        finished = true;
        handlers.onDone(payload);
      } else if (event === "error") {
        finished = true;
        handlers.onError(payload);
      }
    }
  }
  // The connection closed without done/error (server restarted, network drop).
  if (!finished && !signal.aborted) {
    handlers.onError({ reason: "failed", message: "The answer was interrupted. Please ask again.", available_at: null });
  }
}

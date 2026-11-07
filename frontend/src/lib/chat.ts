import { api } from "@/lib/api";

export type SourceCitation = {
  chunk_id: string;
  material_id: string;
  material_title: string;
  page_number: number;
  content: string;
  chunk_type: "text" | "table" | "diagram";
  source: "pdf_text" | "vision";
  similarity: number | null;
  rank: number;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  sources?: SourceCitation[];
};

export type ChatSession = {
  id: string;
  course_id: string | null;
  title: string | null;
  created_at: string;
  updated_at: string;
};

export type ChatSessionDetail = ChatSession & {
  course_name?: string | null;
  messages: ChatMessage[];
};

export function listChatSessions() {
  return api<ChatSession[]>("/chat/sessions");
}

export function createChatSession(data: { course_id?: string | null; title?: string | null } = {}) {
  return api<ChatSession>("/chat/sessions", { method: "POST", body: data });
}

export function getChatSession(id: string) {
  return api<ChatSessionDetail>(`/chat/sessions/${id}`);
}

export function deleteChatSession(id: string) {
  return api<void>(`/chat/sessions/${id}`, { method: "DELETE" });
}

export function sendChatMessage(sessionId: string, content: string) {
  return api<ChatMessage>(`/chat/sessions/${sessionId}/messages`, {
    method: "POST",
    body: { content },
  });
}

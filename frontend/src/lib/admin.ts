import { api } from "@/lib/api";

/*
  Admin dashboard (Stage 8). These types mirror the Admin* schemas in
  backend/app/schemas.py. On purpose there is no field for a course name,
  file title, chat title, question or answer: the backend never sends them
  (role check + read-only database role + response shapes).
*/

export type AdminOverview = {
  users_total: number;
  students: number;
  admins: number;
  inactive_users: number;
  files_total: number;
  files_ready: number;
  files_processing: number;
  files_pending: number;
  files_failed: number;
  files_smart: number;
  files_thorough: number;
  avg_processing_seconds: number | null;
  median_processing_seconds: number | null;
  avg_seconds_per_page: number | null;
  files_timed: number;
  pages_total: number;
  pages_needing_pictures: number;
  pages_read_from_pictures: number;
  pages_picture_failed: number;
  pages_picture_waiting: number;
  passages_total: number;
  passages_embedded: number;
  passages_from_pictures: number;
  chats_total: number;
  chats_empty: number;
  questions_total: number;
};

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: "student" | "admin";
  is_active: boolean;
  joined_at: string;
  course_count: number;
  file_count: number;
  pages_total: number;
  chat_count: number;
  question_count: number;
  not_in_notes_count: number;
  last_question_at: string | null;
};

export type AdminChatDay = {
  day: string; // "2026-11-09" (a day in India time)
  questions: number;
  answered: number;
  not_in_notes: number;
  stopped: number;
  active_users: number;
  prompt_tokens: number;
  output_tokens: number;
};

export type AdminModelUsage = {
  model: string;
  pages_read: number;
  answers: number;
  not_in_notes: number;
  prompt_tokens: number;
  output_tokens: number;
  avg_output_tokens: number | null;
};

export type AdminChatStats = { days: AdminChatDay[]; models: AdminModelUsage[] };

export const getOverview = () => api<AdminOverview>("/admin/overview");
export const listAdminUsers = () => api<AdminUser[]>("/admin/users");
export const setUserActive = (id: string, isActive: boolean) =>
  api<AdminUser>(`/admin/users/${id}`, { method: "PATCH", body: { is_active: isActive } });
export const getChatStats = (days: number) => api<AdminChatStats>(`/admin/stats/chat?days=${days}`);
export const cleanupEmptyChats = () => api<{ deleted: number }>("/admin/cleanup/empty-chats", { method: "POST" });

/** 1234567 -> "1.2M", 15300 -> "15.3K" (token counts get big fast). */
export function compact(n: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

/** Share as a whole percent, or "–" when there is nothing to share. */
export function percent(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : "–";
}

/** 83.4 -> "1 min 23 s", 7.2 -> "7.2 s" */
export function duration(seconds: number | null): string {
  if (seconds === null) return "–";
  if (seconds < 60) return `${seconds.toFixed(1)} s`;
  const m = Math.floor(seconds / 60);
  return `${m} min ${Math.round(seconds - m * 60)} s`;
}

import { api } from "@/lib/api";

/*
  Everything the frontend knows about courses, in one place.
  Each function is one HTTP request to the FastAPI courses router:

    listCourses()        GET    /api/courses
    getCourse(id)        GET    /api/courses/{id}
    createCourse(data)   POST   /api/courses
    updateCourse(id, d)  PATCH  /api/courses/{id}
    deleteCourse(id)     DELETE /api/courses/{id}

  There is no user id anywhere here: the backend reads WHO you are from
  the login cookie, and only ever returns or changes your own courses.
*/

/** One course card, matching CourseSummary in backend/app/schemas.py. */
export type Course = {
  id: string;
  name: string;
  code: string | null;
  description: string | null;
  created_at: string;
  material_count: number;
  ready_material_count: number;
  chunk_count: number;
  last_activity: string;
};

/** What the create/edit form sends. Empty strings become null on the backend. */
export type CourseInput = {
  name: string;
  code: string;
  description: string;
};

export const COURSE_LIMITS = { name: 150, code: 50, description: 2000 } as const;

export function listCourses() {
  return api<Course[]>("/courses");
}

export function getCourse(id: string) {
  return api<Course>(`/courses/${id}`);
}

export function createCourse(data: CourseInput) {
  return api<Course>("/courses", { method: "POST", body: data });
}

export function updateCourse(id: string, data: Partial<CourseInput>) {
  return api<Course>(`/courses/${id}`, { method: "PATCH", body: data });
}

export function deleteCourse(id: string) {
  return api<void>(`/courses/${id}`, { method: "DELETE" });
}

/* "just now", "5 minutes ago", "yesterday", "3 weeks ago" */
const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000],
  ["month", 2_592_000],
  ["week", 604_800],
  ["day", 86_400],
  ["hour", 3_600],
  ["minute", 60],
];

export function timeAgo(iso: string): string {
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  for (const [unit, size] of STEPS) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return "just now";
}

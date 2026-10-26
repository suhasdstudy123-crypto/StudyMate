import { api } from "@/lib/api";

/*
  Search one course (Stage 6).

    searchCourse(courseId, q)   GET /api/courses/{id}/search?q=...&k=8

  The backend searches two ways and merges them (hybrid search):
    by meaning  : the question's vector vs every passage's vector (pgvector)
    by keywords : the question's words in the passage (PostgreSQL full-text)
  meaning_rank / keyword_rank say where a passage was in each list, so the
  result card can show HOW it was found.
*/

/** One passage, matching SearchHit in backend/app/schemas.py. */
export type SearchHit = {
  chunk_id: string;
  material_id: string;
  material_title: string;
  page_number: number;
  chunk_type: "text" | "table" | "diagram";
  /** pdf_text = exact, from the PDF; vision = written by the image reader */
  source: "pdf_text" | "vision";
  content: string;
  score: number;
  meaning_rank: number | null;
  keyword_rank: number | null;
  similarity: number | null;
};

export type SearchResponse = {
  query: string;
  /** keywords = the embedding model isn't ready yet (just restarted), so only words were matched */
  mode: "hybrid" | "keywords";
  took_ms: number;
  results: SearchHit[];
};

// Same limit as MAX_QUESTION_CHARS in backend/app/routers/search.py.
export const MAX_QUERY_CHARS = 500;

export function searchCourse(courseId: string, q: string, k = 8): Promise<SearchResponse> {
  // URLSearchParams encodes the question safely for a URL ("?" "&" "#" spaces ...)
  const params = new URLSearchParams({ q, k: String(k) });
  return api<SearchResponse>(`/courses/${courseId}/search?${params}`);
}

/*
  Which words of a passage to show in bold: the question's words, loosely.
  PostgreSQL matched on word STEMS ("transactions" -> "transact"), so a rough
  stem here (drop common endings, keep at least 4 letters) bolds the same
  family of words. Short and very common words are skipped, like the
  database's stop words. This is only for display; it doesn't affect ranking.
*/
const STOP = new Set(
  "the a an and or of to in on for with is are was were be been what which who whom how why when where does do did can could should would will this that these those it its as at by from into about than then there their they you your my me we our not no".split(
    " ",
  ),
);

export function queryStems(q: string): string[] {
  const stems = new Set<string>();
  for (const raw of q.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []) {
    if (STOP.has(raw)) continue;
    if (/^\d+$/.test(raw)) {
      stems.add(raw); // numbers like 1792 must match exactly
      continue;
    }
    if (raw.length < 3) continue;
    const stem = raw.replace(/(ations?|ions?|ings?|ed|es|s)$/u, "");
    stems.add(stem.length >= 4 ? stem : raw);
  }
  return [...stems];
}

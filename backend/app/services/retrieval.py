"""
Hybrid retrieval service: combines pgvector semantic similarity search
with PostgreSQL Full-Text Search (FTS) using Reciprocal Rank Fusion (RRF).

Strictly enforces:
1. User ownership: only returns materials belonging to the authenticated user.
2. Course scoping: if course_id is specified, restricts chunks to that course;
   otherwise searches all courses belonging to the user.
3. Material readiness: only includes chunks from materials with status = 'ready'.
4. Deduplication: eliminates duplicate or near-identical passages.
"""

import logging
import re
from dataclasses import dataclass
from typing import Any
from uuid import UUID

import numpy as np
from sqlalchemy import text
from sqlalchemy.orm import Session

from backend.app.config import RAG_SIMILARITY_THRESHOLD, RAG_TOP_K
from backend.app.models import Course, DocumentChunk, Material
from backend.app.services.embeddings import embed_text

log = logging.getLogger("studymate.retrieval")

# Common English stop words to exclude from full-text queries
STOP_WORDS = {
    "a", "about", "above", "after", "again", "against", "all", "am", "an", "and", "any",
    "are", "aren't", "as", "at", "be", "because", "been", "before", "being", "below",
    "between", "both", "but", "by", "can", "can't", "cannot", "could", "couldn't", "did",
    "didn't", "do", "does", "doesn't", "doing", "don't", "down", "during", "each", "few",
    "for", "from", "further", "had", "hadn't", "has", "hasn't", "have", "haven't", "having",
    "he", "her", "here", "hers", "herself", "him", "himself", "his", "how", "i", "if", "in",
    "into", "is", "isn't", "it", "it's", "its", "itself", "let's", "me", "more", "most",
    "mustn't", "my", "myself", "no", "nor", "not", "of", "off", "on", "once", "only", "or",
    "other", "ought", "our", "ours", "ourselves", "out", "over", "own", "same", "shan't",
    "she", "should", "shouldn't", "so", "some", "such", "than", "that", "the", "their",
    "theirs", "them", "themselves", "then", "there", "these", "they", "this", "those",
    "through", "to", "too", "under", "until", "up", "very", "was", "wasn't", "we", "were",
    "weren't", "what", "when", "where", "which", "while", "who", "whom", "why", "with",
    "won't", "would", "wouldn't", "you", "your", "yours", "yourself", "yourselves",
}


@dataclass
class RetrievedChunk:
    chunk_id: UUID
    material_id: UUID
    material_title: str
    page_number: int
    content: str
    chunk_type: str
    source: str
    similarity: float
    rank: int


def _cosine_similarity(a: list[float], b: list[float]) -> float:
    va = np.array(a, dtype=np.float32)
    vb = np.array(b, dtype=np.float32)
    norm_a = np.linalg.norm(va)
    norm_b = np.linalg.norm(vb)
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(va, vb) / (norm_a * norm_b))


def _extract_query_keywords(question: str) -> list[str]:
    """Extract informative keywords for full-text search."""
    tokens = re.findall(r"\b[A-Za-z0-9_]{3,}\b", question)
    filtered = [t.lower() for t in tokens if t.lower() not in STOP_WORDS]
    seen = set()
    result = []
    for f in filtered:
        if f not in seen:
            seen.add(f)
            result.append(f)
    return result


def _is_near_duplicate(text1: str, text2: str, threshold: float = 0.80) -> bool:
    """Check if two chunks have very high lexical overlap."""
    words1 = set(re.findall(r"\w+", text1.lower()))
    words2 = set(re.findall(r"\w+", text2.lower()))
    if not words1 or not words2:
        return False
    intersection = len(words1 & words2)
    smaller = min(len(words1), len(words2))
    return (intersection / smaller) >= threshold


def retrieve_relevant_chunks(
    db: Session,
    user_id: UUID,
    question: str,
    course_id: UUID | None = None,
    k: int = RAG_TOP_K,
    min_similarity: float = RAG_SIMILARITY_THRESHOLD,
) -> list[RetrievedChunk]:
    """Retrieve top-k most relevant chunks using Hybrid Search (pgvector dense search +
    PostgreSQL FTS) fused with Reciprocal Rank Fusion (RRF) and deduplication."""
    cleaned_q = question.strip()
    if not cleaned_q:
        return []

    # 1. Generate 384-dim normalized query embedding
    query_vector = embed_text(cleaned_q)

    # 2. Hybrid Retrieval via PostgreSQL (dense + sparse with RRF)
    try:
        k_pool = max(20, k * 3)

        # 2a. Dense pgvector search
        dense_sql = text(
            "SELECT chunk_id, material_id, material_title, page_number, "
            "       content, chunk_type, source, similarity "
            "FROM search_chunks(:query, :user_id, :course_id, :k_pool)"
        )
        dense_rows = db.execute(
            dense_sql,
            {
                "query": str(query_vector),
                "user_id": user_id,
                "course_id": course_id,
                "k_pool": k_pool,
            },
        ).mappings().all()

        # 2b. Sparse Full-Text Search
        keywords = _extract_query_keywords(cleaned_q)
        sparse_rows = []
        if keywords:
            tsquery_str = " | ".join(keywords)
            sparse_sql = text(
                "SELECT dc.id AS chunk_id, m.id AS material_id, m.title AS material_title, "
                "       dc.page_number, dc.content, dc.chunk_type, dc.source, "
                "       ts_rank_cd(dc.content_tsv, to_tsquery('english', :tsquery)) AS fts_score, "
                "       (1 - (dc.embedding <=> :query))::DOUBLE PRECISION AS similarity "
                "FROM document_chunks dc "
                "JOIN materials m ON m.id = dc.material_id "
                "JOIN courses c ON c.id = m.course_id "
                "WHERE (:course_id IS NULL OR c.id = :course_id) "
                "  AND c.user_id = :user_id "
                "  AND m.status = 'ready' "
                "  AND dc.content_tsv @@ to_tsquery('english', :tsquery) "
                "ORDER BY fts_score DESC "
                "LIMIT :k_pool"
            )
            sparse_rows = db.execute(
                sparse_sql,
                {
                    "query": str(query_vector),
                    "user_id": user_id,
                    "course_id": course_id,
                    "tsquery": tsquery_str,
                    "k_pool": k_pool,
                },
            ).mappings().all()

        # 2c. Reciprocal Rank Fusion (RRF: k_rrf = 60)
        k_rrf = 60.0
        rrf_scores: dict[UUID, float] = {}
        chunk_map: dict[UUID, dict[str, Any]] = {}

        for rank, r in enumerate(dense_rows, 1):
            cid = r["chunk_id"]
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + (1.0 / (k_rrf + rank))
            chunk_map[cid] = {
                "chunk_id": cid,
                "material_id": r["material_id"],
                "material_title": r["material_title"],
                "page_number": r["page_number"],
                "content": r["content"],
                "chunk_type": r.get("chunk_type") or "text",
                "source": r.get("source") or "pdf_text",
                "similarity": float(r["similarity"]) if r["similarity"] is not None else 0.0,
                "dense_rank": rank,
            }

        for rank, r in enumerate(sparse_rows, 1):
            cid = r["chunk_id"]
            rrf_scores[cid] = rrf_scores.get(cid, 0.0) + (1.0 / (k_rrf + rank))
            if cid not in chunk_map:
                chunk_map[cid] = {
                    "chunk_id": cid,
                    "material_id": r["material_id"],
                    "material_title": r["material_title"],
                    "page_number": r["page_number"],
                    "content": r["content"],
                    "chunk_type": r.get("chunk_type") or "text",
                    "source": r.get("source") or "pdf_text",
                    "similarity": float(r["similarity"]) if r["similarity"] is not None else 0.0,
                    "dense_rank": None,
                }

        # Sort candidate pool by RRF score descending
        fused = sorted(chunk_map.values(), key=lambda c: rrf_scores[c["chunk_id"]], reverse=True)

        # 2d. Deduplication and quality filtering
        deduped: list[dict[str, Any]] = []
        seen_pages: set[tuple[UUID, int]] = set()

        for c in fused:
            if c["similarity"] > 0.0 and c["similarity"] < min_similarity:
                if rrf_scores[c["chunk_id"]] < (1.0 / (k_rrf + 5)):
                    continue

            page_key = (c["material_id"], c["page_number"])
            if page_key in seen_pages:
                if any(_is_near_duplicate(c["content"], acc["content"]) for acc in deduped):
                    continue

            if any(_is_near_duplicate(c["content"], acc["content"]) for acc in deduped):
                continue

            seen_pages.add(page_key)
            deduped.append(c)
            if len(deduped) >= k:
                break

        if deduped:
            return [
                RetrievedChunk(
                    chunk_id=c["chunk_id"],
                    material_id=c["material_id"],
                    material_title=c["material_title"],
                    page_number=c["page_number"],
                    content=c["content"],
                    chunk_type=c["chunk_type"],
                    source=c["source"],
                    similarity=round(c["similarity"], 4),
                    rank=i + 1,
                )
                for i, c in enumerate(deduped)
            ]

    except Exception as exc:
        log.warning(
            "Hybrid search failed (%s). Falling back to ORM query...",
            exc,
        )

    # Fallback path for unit tests running against SQLite or when pgvector is mocked
    query = (
        db.query(
            DocumentChunk.id.label("chunk_id"),
            Material.id.label("material_id"),
            Material.title.label("material_title"),
            DocumentChunk.page_number,
            DocumentChunk.content,
            DocumentChunk.chunk_type,
            DocumentChunk.source,
            DocumentChunk.embedding,
        )
        .join(Material, Material.id == DocumentChunk.material_id)
        .join(Course, Course.id == Material.course_id)
        .filter(
            Course.user_id == user_id,
            Material.status == "ready",
            DocumentChunk.embedding.isnot(None),
        )
    )

    if course_id is not None:
        query = query.filter(Course.id == course_id)

    candidates = query.all()
    if not candidates:
        return []

    scored: list[tuple[float, Any]] = []
    for cand in candidates:
        if cand.embedding is None:
            continue
        sim = _cosine_similarity(query_vector, cand.embedding)
        if sim >= min_similarity:
            scored.append((sim, cand))

    scored.sort(key=lambda x: x[0], reverse=True)

    deduped_candidates: list[tuple[float, Any]] = []
    for sim, cand in scored:
        if any(_is_near_duplicate(cand.content, d_cand.content) for _, d_cand in deduped_candidates):
            continue
        deduped_candidates.append((sim, cand))
        if len(deduped_candidates) >= k:
            break

    return [
        RetrievedChunk(
            chunk_id=c.chunk_id,
            material_id=c.material_id,
            material_title=c.material_title,
            page_number=c.page_number,
            content=c.content,
            chunk_type=c.chunk_type or "text",
            source=c.source or "pdf_text",
            similarity=round(sim, 4),
            rank=i + 1,
        )
        for i, (sim, c) in enumerate(deduped_candidates)
    ]

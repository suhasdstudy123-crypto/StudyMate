import sys, os, time, json, truststore
truststore.inject_into_ssl()
from uuid import UUID
from backend.app.database import SessionLocal
from backend.app.services.rag import generate_rag_answer

sys.stdout.reconfigure(encoding='utf-8')

USER_ID = UUID("efd327cf-37fb-468f-9a44-79f6c3628772")
COURSE_ID = UUID("c91fa38c-bb1d-4f3a-a66d-107fd6b52d09")

QUESTIONS = [
    {
        "id": "Test 1",
        "title": "Relational vs Vector Database",
        "question": "What is the difference between a relational database and a vector database according to the lecture notes?",
        "expected_topics": ["relational", "vector", "table", "embeddings", "exact", "similarity"]
    },
    {
        "id": "Test 2",
        "title": "Identifying Same Topic Using Different Words",
        "question": "How can a vector database identify two documents that discuss the same topic using different words?",
        "expected_topics": ["embeddings", "semantic", "meaning", "synonyms", "distance", "similarity"]
    },
    {
        "id": "Test 3",
        "title": "Semantic Search vs Traditional Full-Text Search",
        "question": "Why is semantic search considered better than traditional full-text search in DBMS?",
        "expected_topics": ["semantic", "full-text", "keywords", "exact match", "context"]
    },
    {
        "id": "Test 4",
        "title": "Role and Generation of Embeddings",
        "question": "What is the role of embeddings in vector databases and how are they generated?",
        "expected_topics": ["embeddings", "machine learning", "models", "high-dimensional", "vectors"]
    },
    {
        "id": "Test 5",
        "title": "Cosine Similarity Calculation",
        "question": "Explain how cosine similarity is calculated between two vectors based on the slide example.",
        "expected_topics": ["cosine", "dot product", "magnitude", "angle", "formula", "similarity"]
    },
    {
        "id": "Test 6",
        "title": "FTS vs Vector Search Comparison Table",
        "question": "Compare Full-Text Search and Vector Search using the comparison table from the notes.",
        "expected_topics": ["Full-Text Search", "Vector Search", "tokens", "embeddings", "inverted index", "HNSW", "table"]
    },
    {
        "id": "Test 7",
        "title": "Healthcare and Life Sciences Applications",
        "question": "What are the applications of vector databases in healthcare and life sciences mentioned in the slides?",
        "expected_topics": ["healthcare", "genomics", "molecular biology", "genetic sequences", "protein structures"]
    },
    {
        "id": "Negative Test",
        "title": "Out-of-Domain DBMS Topic",
        "question": "Explain how B+ Tree index node splitting works during an insert operation in DBMS.",
        "expected_topics": ["insufficient", "not found", "uploaded study materials"]
    }
]

print("=== STARTING MANDATORY RAG TEST SUITE ===")
results_summary = []

for item in QUESTIONS:
    print(f"\n=======================================================")
    print(f"Executing {item['id']}: {item['title']}")
    print(f"Question: \"{item['question']}\"")
    print(f"=======================================================")

    t0 = time.time()
    db = SessionLocal()
    try:
        rag_answer = generate_rag_answer(
            db=db,
            user_id=USER_ID,
            question=item["question"],
            course_id=COURSE_ID,
            k=5
        )
    finally:
        db.close()
    elapsed = time.time() - t0

    sources = rag_answer.sources
    answer = rag_answer.answer

    print(f"Response Time: {elapsed:.2f}s")
    print(f"Retrieved Chunks Count: {len(sources)}")
    print("Retrieved Chunks:")
    for s in sources:
        print(f"  [Source {s.rank}] Page {s.page_number} (Sim: {s.similarity:.4f}, Type: {s.chunk_type}): {s.content[:90]}...")

    print("\nGenerated Answer:")
    print(answer)

    # Check for in-text citations
    import re
    citations_found = re.findall(r'\[Source\s*(\d+)\]', answer)
    has_table = "|" in answer and "---" in answer

    test_record = {
        "id": item["id"],
        "title": item["title"],
        "question": item["question"],
        "elapsed_sec": round(elapsed, 2),
        "chunk_count": len(sources),
        "chunks": [
            {
                "rank": s.rank,
                "page": s.page_number,
                "similarity": s.similarity,
                "type": s.chunk_type,
                "source": s.source,
                "snippet": s.content[:160]
            }
            for s in sources
        ],
        "citations": citations_found,
        "has_markdown_table": has_table,
        "answer": answer
    }
    results_summary.append(test_record)

with open("rag_test_results.json", "w", encoding="utf-8") as f:
    json.dump(results_summary, f, indent=2, ensure_ascii=False)

print("\n=== ALL TESTS COMPLETED SUCCESSFULLY ===")
print("Results saved to rag_test_results.json")

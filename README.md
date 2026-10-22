# StudyMate

An AI-powered study assistant. Students upload their study material (notes, previous-year question papers) as PDFs and ask questions in plain language. StudyMate answers using the uploaded material and shows which document and page each answer came from.

It uses Retrieval-Augmented Generation (RAG): the PDF text is split into chunks, each chunk is converted into an embedding, and the embeddings are stored in PostgreSQL with pgvector. A question is embedded the same way, the closest chunks are retrieved, and an LLM writes the answer from those chunks.

## Tech stack

- Frontend: Next.js (TypeScript, Tailwind CSS, App Router)
- Backend: FastAPI (Python)
- Database: PostgreSQL 17 with the pgvector extension
- Embeddings: all-MiniLM-L6-v2 (sentence-transformers)
- Auth: JWT with Student and Admin roles

Data flow: Next.js -> FastAPI -> PostgreSQL. The frontend never connects to the database directly.

## Status

In active development.

- Phase 0 (project setup): done
- Phase 1 (PostgreSQL + pgvector): done
- Phase 2 (database design): next

## Limitations

- Text-only processing. Only text that can be extracted from a PDF is searched and used in answers.
- Diagrams and images inside a PDF (for example ER diagrams and flowcharts) are ignored.
- Scanned or photographed pages, including handwritten notes, contain no extractable text and are not supported. Such uploads are rejected with a clear error instead of failing silently.
- Tables and formulas may be extracted as jumbled text, so their meaning can be partly lost.
- Answers are written by an LLM from the retrieved chunks, so they are not word-for-word copies of the PDF and can occasionally contain mistakes. The source document and page are shown with every answer so it can be checked against the original.

## Future scope

The pipeline is modular: everything after text extraction (chunking, embedding, storage, search, answering) works on text chunks regardless of where the text came from. Support for non-text content can be added at the front of the pipeline without changing the rest.

- OCR (for example Tesseract) to extract text from scanned pages and previous-year question papers.
- A vision-capable LLM to describe diagrams and images. The description is stored as a normal text chunk.
- A `chunk_type` column on the chunks table (for example `text`, `ocr`, `image_description`) to record where each chunk came from.
- Searching images directly would need a multimodal embedding model and a different vector size, so describing images as text is the preferred approach.

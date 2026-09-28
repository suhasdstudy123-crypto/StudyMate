from fastapi import FastAPI

app = FastAPI(
    title="StudyMate API",
    description="Backend API for the StudyMate project",
    version="0.1.0",
)


@app.get("/health")
def health_check():
    return {
        "status": "ok",
        "service": "StudyMate API",
    }
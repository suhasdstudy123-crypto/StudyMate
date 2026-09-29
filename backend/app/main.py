from fastapi import FastAPI

app = FastAPI()


@app.get("/health")
def health():
    # Simple liveness check
    return {"status": "ok"}

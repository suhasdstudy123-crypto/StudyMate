"""
GET /vision/status   is the image reader working, and if not, why?

The course page shows this next to files that have picture pages waiting,
so a student sees "paused until 12:30 PM" instead of a silent wait.
"""

from datetime import datetime, timezone

from fastapi import APIRouter, Depends

from backend.app.deps import get_current_user
from backend.app.models import User
from backend.app.processing import vision_worker
from backend.app.schemas import VisionStatus

router = APIRouter(prefix="/vision", tags=["Image reader"])


@router.get("/status", response_model=VisionStatus)
def vision_status(current_user: User = Depends(get_current_user)):
    s = vision_worker.state
    if not s.enabled:
        status, message = "off", "Reading pictures is switched off: no Gemini API key is set on the server."
    elif s.config_error:
        # The exact reason (wrong key, unknown model) is in the server log;
        # students only need to know it's a setup problem, not their file.
        status, message = "error", "Reading pictures is paused because of a setup problem on the server."
    elif s.paused_until and s.pause_reason == "busy":
        status, message = "paused", "Google's image reader is overloaded right now."
    elif s.paused_until:
        status, message = "paused", "Today's free limit for reading pictures is used up."
    else:
        status, message = "ok", None
    paused_until = (
        datetime.fromtimestamp(s.paused_until, timezone.utc) if status == "paused" and s.paused_until else None
    )
    return VisionStatus(status=status, message=message, paused_until=paused_until)

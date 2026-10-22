"""
Admin-only endpoints. Every route here depends on require_admin,
so a student gets 403 and an anonymous visitor gets 401.
Stage 8 grows this into the full admin dashboard.
"""

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from backend.app.database import get_db
from backend.app.deps import require_admin
from backend.app.models import User
from backend.app.schemas import UserResponse

# dependencies=[...] on the router applies the check to EVERY route
# in this file, so a future admin route can't forget it.
router = APIRouter(prefix="/admin", tags=["Admin"], dependencies=[Depends(require_admin)])


@router.get("/users", response_model=list[UserResponse])
def list_users(db: Session = Depends(get_db)):
    return db.query(User).order_by(User.created_at).all()

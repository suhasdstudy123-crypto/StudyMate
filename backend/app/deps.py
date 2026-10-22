"""
Route dependencies for authentication and authorization.

A route that needs a logged-in user declares:
    current_user: User = Depends(get_current_user)
FastAPI runs get_current_user BEFORE the route body. If it raises,
the route never runs. That is how a route becomes "protected".

  get_current_user -> authentication: WHO are you?      (fails with 401)
  require_admin    -> authorization:  are you ALLOWED?  (fails with 403)
"""

from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from backend.app.config import AUTH_COOKIE_NAME
from backend.app.database import get_db
from backend.app.models import User
from backend.app.security import decode_access_token

# Reads an "Authorization: Bearer <token>" header if present.
# auto_error=False: don't fail here, because the token may come from
# the cookie instead. It also adds the "Authorize" button to /docs.
_bearer = HTTPBearer(auto_error=False)


def _unauthorized(detail: str = "Not authenticated") -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=detail,
        headers={"WWW-Authenticate": "Bearer"},
    )


def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
    db: Session = Depends(get_db),
) -> User:
    # 1. Find the token: explicit Authorization header first (API clients,
    #    /docs), otherwise the httpOnly cookie the browser sends itself.
    token = credentials.credentials if credentials else request.cookies.get(AUTH_COOKIE_NAME)
    if not token:
        raise _unauthorized()

    # 2. Check signature + expiry, and read the user id out of it.
    user_id = decode_access_token(token)
    if user_id is None:
        raise _unauthorized("Invalid or expired token")

    # 3. Load the user fresh from the database on every request.
    #    The token only says WHO; the database says what they are NOW,
    #    so a deactivated account or a changed role takes effect at once.
    user = db.get(User, user_id)
    if user is None or not user.is_active:
        raise _unauthorized("Account not found or disabled")

    return user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status.HTTP_403_FORBIDDEN, "Admin access required")
    return current_user

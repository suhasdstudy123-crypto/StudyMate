"""
Authentication endpoints: register, login, logout, "who am I".

Login flow:
  browser sends email + password
    -> find user by email
    -> verify password against the stored Argon2 hash
    -> create a signed JWT containing the user id
    -> put it in an httpOnly cookie (browser) and the response body (API clients)
  every later request carries the token -> deps.get_current_user checks it.
"""

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.app.config import ACCESS_TOKEN_EXPIRE_MINUTES, AUTH_COOKIE_NAME, COOKIE_SECURE
from backend.app.database import get_db
from backend.app.deps import get_current_user
from backend.app.models import User
from backend.app.schemas import AuthResponse, LoginRequest, RegisterRequest, UserResponse
from backend.app.security import (
    create_access_token,
    hash_password,
    needs_rehash,
    verify_password,
)

router = APIRouter(prefix="/auth", tags=["Auth"])


def _issue_token(response: Response, user: User) -> AuthResponse:
    token = create_access_token(user.id)
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=token,
        max_age=ACCESS_TOKEN_EXPIRE_MINUTES * 60,  # seconds; same as the JWT expiry
        httponly=True,   # JavaScript can't read it -> an XSS bug can't steal it
        secure=COOKIE_SECURE,  # HTTPS-only in production
        samesite="lax",  # not sent on cross-site POSTs -> blocks basic CSRF
        path="/",
    )
    return AuthResponse(access_token=token, user=UserResponse.model_validate(user))


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(data: RegisterRequest, response: Response, db: Session = Depends(get_db)):
    user = User(
        name=data.name,
        email=data.email,
        password_hash=hash_password(data.password),  # never the raw password
        # role is not set -> the database DEFAULT 'student' applies.
    )
    db.add(user)
    try:
        db.commit()
    except IntegrityError:
        # users_email_unique rejected it: the database is the final
        # guard, even if two sign-ups with one email race each other.
        db.rollback()
        raise HTTPException(status.HTTP_409_CONFLICT, "An account with this email already exists")
    db.refresh(user)

    # Log the new user straight in, like most sites do.
    return _issue_token(response, user)


@router.post("/login", response_model=AuthResponse)
def login(data: LoginRequest, response: Response, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()

    # verify_password runs even when the user doesn't exist (dummy hash),
    # and both failures return the SAME message. So an attacker can't
    # use this endpoint to discover which emails have accounts.
    password_ok = verify_password(data.password, user.password_hash if user else None)
    if user is None or not password_ok:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "Invalid email or password")

    if not user.is_active:
        raise HTTPException(status.HTTP_403_FORBIDDEN, "This account has been disabled")

    # If hashing settings were strengthened since this hash was made,
    # re-hash now while we have the plain password.
    if needs_rehash(user.password_hash):
        user.password_hash = hash_password(data.password)
        db.commit()
        db.refresh(user)

    return _issue_token(response, user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response):
    # Tells the browser to delete the cookie. The JWT itself stays valid
    # until it expires (it's stateless) - a known trade-off of JWTs.
    response.delete_cookie(
        AUTH_COOKIE_NAME, path="/", httponly=True, secure=COOKIE_SECURE, samesite="lax"
    )


@router.get("/me", response_model=UserResponse)
def me(current_user: User = Depends(get_current_user)):
    # The frontend calls this on page load to know who is logged in.
    return current_user

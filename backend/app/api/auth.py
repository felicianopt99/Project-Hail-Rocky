from fastapi import APIRouter, HTTPException, Depends, status
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from pydantic import BaseModel

from ..config import settings
from ..core.security import verify_password, create_access_token, create_refresh_token, decode_token, blacklist_token, is_blacklisted

router = APIRouter()
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login")


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


async def get_current_user(token: str = Depends(oauth2_scheme)) -> dict:
    payload = decode_token(token)
    if not payload or payload.get("sub") != settings.admin_username:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
    if await is_blacklisted(token):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token revoked")
    return {"username": payload["sub"]}


@router.post("/login", response_model=TokenResponse)
async def login(form: OAuth2PasswordRequestForm = Depends()):
    if form.username != settings.admin_username:
        raise HTTPException(status_code=400, detail="Incorrect credentials")
    if not verify_password(form.password, settings.admin_password_hash):
        raise HTTPException(status_code=400, detail="Incorrect credentials")
    data = {"sub": form.username}
    return TokenResponse(
        access_token=create_access_token(data),
        refresh_token=create_refresh_token(data),
    )


@router.post("/refresh", response_model=TokenResponse)
async def refresh(body: RefreshRequest):
    payload = decode_token(body.refresh_token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid refresh token")
    if await is_blacklisted(body.refresh_token):
        raise HTTPException(status_code=401, detail="Refresh token revoked")
    data = {"sub": payload["sub"]}
    return TokenResponse(
        access_token=create_access_token(data),
        refresh_token=create_refresh_token(data),
    )


@router.post("/logout")
async def logout(token: str = Depends(oauth2_scheme)):
    """Invalidate the current access token by adding it to the Redis blacklist."""
    await blacklist_token(token)
    return {"detail": "Logged out"}


@router.get("/me")
async def me(user: dict = Depends(get_current_user)):
    return {"username": user["username"]}


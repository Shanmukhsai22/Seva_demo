import httpx
from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from .config import settings
from .db import db

bearer = HTTPBearer(auto_error=False)


async def current_user(credentials: HTTPAuthorizationCredentials | None = Depends(bearer)):
    if not credentials:
        raise HTTPException(401, 'authError')
    if not settings.configured or db.client is None:
        raise HTTPException(503, 'setupRequired')
    try:
        response = await db.client.get(f'{settings.supabase_url.rstrip("/")}/auth/v1/user',
            headers={'apikey': settings.supabase_service_role_key, 'Authorization': f'Bearer {credentials.credentials}'})
    except httpx.RequestError:
        raise HTTPException(503, 'serviceUnavailable') from None
    if response.status_code != 200:
        raise HTTPException(401, 'authError')
    user = response.json()
    if not user.get('phone_confirmed_at'):
        raise HTTPException(401, 'authError')
    rows = await db.rows('profiles', id=f'eq.{user["id"]}', select='*', limit='1')
    if not rows:
        raise HTTPException(403, 'forbidden')
    # Never derive roles from user-editable auth metadata.
    return rows[0]


async def admin(user=Depends(current_user)):
    if user['role'] != 'admin':
        raise HTTPException(403, 'forbidden')
    return user


def can_read_consultation(user, consultation):
    return user['role'] == 'admin' or consultation['user_id'] == user['id'] or (
        user['role'] == 'ayyagaru' and consultation['assigned_to'] == user['id'])

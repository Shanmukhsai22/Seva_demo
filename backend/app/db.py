import httpx
from fastapi import HTTPException
from .config import settings

PUBLIC_ERRORS = {'eventClosed', 'alreadyBooked', 'eventFull', 'forbidden', 'setupRequired', 'noteRequired'}


class Database:
    def __init__(self):
        self.client: httpx.AsyncClient | None = None

    async def open(self):
        self.client = httpx.AsyncClient(timeout=20)

    async def close(self):
        if self.client:
            await self.client.aclose()

    def headers(self):
        if not settings.configured:
            raise HTTPException(503, 'setupRequired')
        return {'apikey': settings.supabase_service_role_key, 'Authorization': f'Bearer {settings.supabase_service_role_key}'}

    async def request(self, method, path, *, params=None, json=None, content=None, headers=None):
        if self.client is None:
            raise HTTPException(503, 'serviceUnavailable')
        try:
            response = await self.client.request(method, f'{settings.supabase_url.rstrip("/")}{path}', params=params,
                json=json, content=content, headers={**self.headers(), **(headers or {})})
        except httpx.RequestError:
            raise HTTPException(503, 'serviceUnavailable') from None
        if response.is_error:
            try:
                payload = response.json()
            except ValueError:
                payload = {}
            message = payload.get('message')
            if message in PUBLIC_ERRORS:
                raise HTTPException(409, message)
            if payload.get('code') == '23505':
                raise HTTPException(409, 'alreadyBooked')
            raise HTTPException(503, 'serviceUnavailable')
        return response.json() if response.content else None

    async def rows(self, table, **params):
        return await self.request('GET', f'/rest/v1/{table}', params=params)

    async def insert(self, table, payload):
        return await self.request('POST', f'/rest/v1/{table}', json=payload, headers={'Prefer': 'return=representation'})

    async def patch(self, table, payload, **params):
        return await self.request('PATCH', f'/rest/v1/{table}', params=params, json=payload, headers={'Prefer': 'return=representation'})

    async def rpc(self, name, payload=None):
        result = await self.request('POST', f'/rest/v1/rpc/{name}', json=payload or {})
        if name in {'book_event', 'create_consultation'} and isinstance(result, list):
            return result[0] if result else None
        return result


db = Database()

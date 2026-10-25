from contextlib import asynccontextmanager
from datetime import datetime, timezone
from io import BytesIO
from uuid import UUID, uuid4
import warnings
from fastapi import Depends, FastAPI, File, Form, HTTPException, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from .auth import admin, can_read_consultation, current_user
from .config import settings
from .db import db
from .models import Assignment, EventInput, Guidance, Preferences, ServiceSettings, TeamMember

MAX_IMAGE = 10 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 20_000_000


@asynccontextmanager
async def lifespan(app):
    await db.open()
    yield
    await db.close()


app = FastAPI(title='Ekatvam Seva API', version='0.1.0', lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins,
    allow_credentials=False, allow_methods=['GET', 'POST', 'PATCH'], allow_headers=['Authorization', 'Content-Type'])


@app.exception_handler(RequestValidationError)
async def validation_error(request, exc):
    return JSONResponse(status_code=422, content={'detail': 'invalidEvent' if '/events' in request.url.path else 'requestFailed'})


@app.get('/health')
async def health():
    return {'status': 'ok', 'configured': settings.configured, 'payments_enabled': False}


@app.get('/settings')
async def get_settings():
    rows = await db.rows('service_settings', id='eq.1', select='consultation_fee_paise')
    return rows[0]


@app.get('/me')
async def me(user=Depends(current_user)):
    return user


@app.patch('/me')
async def update_preferences(body: Preferences, user=Depends(current_user)):
    update = body.model_dump()
    if user['role'] == 'user':
        update.pop('available')
    if body.whatsapp_opt_in != user['whatsapp_opt_in']:
        update['whatsapp_opt_in_at'] = datetime.now(timezone.utc).isoformat() if body.whatsapp_opt_in else None
    result = await db.patch('profiles', update, id=f'eq.{user["id"]}')
    if not body.whatsapp_opt_in:
        await db.patch('notifications', {'status':'cancelled'}, recipient_id=f'eq.{user["id"]}', status='eq.queued')
    if user['role'] == 'ayyagaru' and body.available:
        await db.rpc('assign_waiting_consultations')
    return result[0]


@app.get('/events')
async def list_events():
    events = await db.rows('events', published='eq.true', starts_at=f'gt.{datetime.now(timezone.utc).isoformat()}', order='starts_at.asc', select='*')
    # Aggregate in SQL through RPC to avoid PostgREST's row limit truncating counts.
    counts = await db.rpc('event_booking_counts')
    count_by_event = {row['event_id']: row['confirmed_count'] for row in counts}
    return [{**event, 'available': max(0,event['capacity']-count_by_event.get(event['id'],0))} for event in events]


@app.post('/events/{event_id}/book', status_code=201)
async def book(event_id: UUID, user=Depends(current_user)):
    return await db.rpc('book_event', {'p_event':str(event_id),'p_user':user['id']})


@app.get('/bookings')
async def my_bookings(user=Depends(current_user)):
    return await db.rows('bookings', user_id=f'eq.{user["id"]}', select='*,events(*)', order='created_at.desc')


def sanitise_image(raw: bytes) -> bytes:
    try:
        with warnings.catch_warnings():
            warnings.simplefilter('error', Image.DecompressionBombWarning)
            with Image.open(BytesIO(raw)) as original:
                if original.format not in {'JPEG','PNG','WEBP'}:
                    raise ValueError('Unsupported image')
                oriented = ImageOps.exif_transpose(original)
                if 'A' in oriented.getbands() or 'transparency' in oriented.info:
                    rgba = oriented.convert('RGBA')
                    image = Image.new('RGB', rgba.size, 'white')
                    image.paste(rgba, mask=rgba.getchannel('A'))
                else:
                    image = oriented.convert('RGB')
                image.thumbnail((5000,5000))
                output = BytesIO()
                image.save(output, format='JPEG', quality=90)
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, 'invalidImage') from None


@app.post('/consultations', status_code=201)
async def create_consultation(image: UploadFile = File(...), notes: str = Form(..., min_length=1, max_length=4000), user=Depends(current_user)):
    if not notes.strip():
        raise HTTPException(422, 'noteRequired')
    if image.content_type not in {'image/jpeg','image/png','image/webp'}:
        raise HTTPException(422, 'invalidImage')
    raw = await image.read(MAX_IMAGE + 1)
    await image.close()
    if not raw or len(raw) > MAX_IMAGE:
        raise HTTPException(422, 'invalidImage')
    # Decode and re-encode rather than trusting file names or browser MIME types.
    from starlette.concurrency import run_in_threadpool
    clean = await run_in_threadpool(sanitise_image, raw)
    if len(clean) > MAX_IMAGE:
        raise HTTPException(422, 'invalidImage')
    path = f'{user["id"]}/{uuid4()}.jpg'
    await db.request('POST', f'/storage/v1/object/jatakams/{path}', content=clean, headers={'Content-Type':'image/jpeg'})
    try:
        return await db.rpc('create_consultation', {'p_user':user['id'],'p_image':path,'p_notes':notes.strip()})
    except HTTPException as error:
        # A timeout may hide a committed DB transaction. Keep the image in that
        # case; deleting it could destroy an already-linked consultation asset.
        if error.status_code < 500:
            try:
                await db.request('DELETE', '/storage/v1/object/jatakams', json={'prefixes':[path]})
            except HTTPException:
                pass
        raise


@app.get('/consultations')
async def list_consultations(user=Depends(current_user)):
    filters = {} if user['role']=='admin' else {'assigned_to':f'eq.{user["id"]}'} if user['role']=='ayyagaru' else {'user_id':f'eq.{user["id"]}'}
    return await db.rows('consultations', select='*', order='created_at.desc', **filters)


@app.get('/consultations/{request_id}/image')
async def consultation_image(request_id: UUID, user=Depends(current_user)):
    rows = await db.rows('consultations', id=f'eq.{request_id}', select='*', limit='1')
    if not rows or not can_read_consultation(user,rows[0]):
        raise HTTPException(404, 'forbidden')
    result = await db.request('POST', f'/storage/v1/object/sign/jatakams/{rows[0]["image_path"]}', json={'expiresIn':60})
    return {'url':f'{settings.supabase_url.rstrip("/")}/storage/v1{result["signedURL"]}'}


@app.post('/consultations/{request_id}/complete')
async def complete(request_id: UUID, body: Guidance, user=Depends(current_user)):
    if user['role'] != 'ayyagaru':
        raise HTTPException(403,'forbidden')
    await db.rpc('complete_consultation', {'p_request':str(request_id),'p_assignee':user['id'],'p_response':body.response})
    return {'ok':True}


@app.get('/admin/team')
async def list_team(user=Depends(admin)):
    return await db.rows('profiles', role='eq.ayyagaru', select='*', order='created_at.asc')


@app.post('/admin/team', status_code=201)
async def add_team(body: TeamMember, user=Depends(admin)):
    rows = await db.rows('profiles', phone=f'eq.{body.phone}', role='neq.admin', select='id', limit='1')
    if not rows:
        raise HTTPException(404,'memberNotFound')
    # A profile can exist before signup verification; check auth state before promotion.
    auth_user = await db.request('GET', f'/auth/v1/admin/users/{rows[0]["id"]}')
    if not auth_user.get('phone_confirmed_at'):
        raise HTTPException(409,'memberNotFound')
    result = await db.patch('profiles', {'role':'ayyagaru','available':True}, id=f'eq.{rows[0]["id"]}')
    await db.rpc('assign_waiting_consultations')
    return result[0]


@app.post('/admin/consultations/{request_id}/assign')
async def assign(request_id: UUID, body: Assignment, user=Depends(admin)):
    await db.rpc('reassign_consultation', {'p_request':str(request_id),'p_assignee':str(body.assigned_to)})
    return {'ok':True}


@app.get('/admin/events')
async def admin_events(user=Depends(admin)):
    return await db.rows('events', select='*', order='created_at.desc')


@app.post('/admin/events', status_code=201)
async def create_event(body: EventInput, user=Depends(admin)):
    return (await db.insert('events', {**body.model_dump(mode='json'),'created_by':user['id']}))[0]


@app.post('/admin/events/{event_id}/publish')
async def publish(event_id: UUID, user=Depends(admin)):
    rows = await db.rows('events', id=f'eq.{event_id}', select='id', limit='1')
    if not rows:
        raise HTTPException(404,'eventClosed')
    await db.rpc('publish_event', {'p_event':str(event_id)})
    return {'ok':True}


@app.patch('/admin/settings')
async def update_settings(body: ServiceSettings, user=Depends(admin)):
    return (await db.patch('service_settings',body.model_dump(),id='eq.1'))[0]


@app.get('/admin/notifications')
async def notification_queue(user=Depends(admin)):
    return await db.rows('notifications', select='id,status,kind,created_at',order='created_at.desc',limit='100')

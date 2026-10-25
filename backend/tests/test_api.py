from datetime import datetime, timedelta, timezone
from io import BytesIO
from uuid import uuid4
from fastapi.testclient import TestClient
from PIL import Image
from pydantic import ValidationError
import pytest
from app.auth import can_read_consultation, current_user
from app.main import app, sanitise_image
from app.models import EventInput, Preferences
from app.db import db

USER = {'id':str(uuid4()),'role':'user','name':'Test member'}
OTHER = str(uuid4())


def test_private_consultation_ownership():
    request = {'user_id':USER['id'],'assigned_to':OTHER}
    assert can_read_consultation(USER,request)
    assert not can_read_consultation({'id':OTHER,'role':'user'},request)
    assert can_read_consultation({'id':OTHER,'role':'ayyagaru'},request)
    assert not can_read_consultation({'id':str(uuid4()),'role':'ayyagaru'},request)
    assert can_read_consultation({'id':str(uuid4()),'role':'admin'},request)


def test_role_cannot_be_changed_in_preferences():
    with pytest.raises(ValidationError):
        Preferences(language='te',whatsapp_opt_in=True,role='admin')


def test_event_requires_all_three_translations_and_future_time():
    payload = {'title':{'en':'Test','te':'పరీక్ష','hi':'परीक्षण'},'description':{'en':'Test','te':'పరీక్ష','hi':'परीक्षण'},
        'venue':{'en':'Test','te':'పరీక్ష','hi':'परीक्षण'},'starts_at':datetime.now(timezone.utc)+timedelta(days=1),'fee_paise':0,'capacity':1}
    assert EventInput(**payload).capacity == 1
    for replacement in ({'title':{'en':'Test'}},{'starts_at':datetime.now(timezone.utc)-timedelta(days=1)},{'capacity':0},{'fee_paise':-1}):
        with pytest.raises(ValidationError):
            EventInput(**(payload|replacement))


def test_image_rejects_html_and_removes_exif():
    from fastapi import HTTPException
    with pytest.raises(HTTPException):
        sanitise_image(b'<html>not a picture</html>')
    raw=BytesIO()
    image=Image.new('RGB',(10,10),'white')
    exif=Image.Exif(); exif[270]='Private metadata'
    image.save(raw,format='JPEG',exif=exif)
    cleaned=Image.open(BytesIO(sanitise_image(raw.getvalue())))
    assert cleaned.format=='JPEG'
    assert not cleaned.getexif()


def test_transparent_chart_background_becomes_white():
    raw=BytesIO()
    Image.new('RGBA',(10,10),(0,0,0,0)).save(raw,format='PNG')
    cleaned=Image.open(BytesIO(sanitise_image(raw.getvalue())))
    assert cleaned.getpixel((0,0))==(255,255,255)


def test_protected_routes_require_authentication():
    with TestClient(app) as client:
        assert client.get('/health').json()['payments_enabled'] is False
        for route in ('/me','/bookings','/consultations','/admin/team','/admin/events','/admin/notifications'):
            assert client.get(route).status_code == 401


def test_user_cannot_call_admin_or_complete_consultation():
    app.dependency_overrides[current_user]=lambda:USER
    try:
        with TestClient(app) as client:
            assert client.get('/admin/team').status_code==403
            assert client.post(f'/consultations/{uuid4()}/complete',json={'response':'Test'}).status_code==403
    finally:
        app.dependency_overrides.clear()


def test_signed_image_denies_unassigned_user(monkeypatch):
    async def rows(*args,**kwargs):
        return [{'user_id':OTHER,'assigned_to':None,'image_path':'private.jpg'}]
    monkeypatch.setattr(db,'rows',rows)
    app.dependency_overrides[current_user]=lambda:USER
    try:
        with TestClient(app) as client:
            assert client.get(f'/consultations/{uuid4()}/image').status_code==404
    finally:
        app.dependency_overrides.clear()


def test_paid_bookings_are_not_converted_to_confirmed_by_api(monkeypatch):
    calls=[]
    async def rpc(name,payload):
        calls.append((name,payload))
        return {'status':'awaiting_payment'}
    monkeypatch.setattr(db,'rpc',rpc)
    app.dependency_overrides[current_user]=lambda:USER
    try:
        with TestClient(app) as client:
            result=client.post(f'/events/{uuid4()}/book',json={'status':'confirmed','fee_paise':0})
            assert result.status_code==201
            assert result.json()['status']=='awaiting_payment'
            assert set(calls[0][1])=={'p_event','p_user'}
    finally:
        app.dependency_overrides.clear()


@pytest.mark.parametrize('status,expect_cleanup',[(503,False),(409,True)])
def test_image_preserved_after_ambiguous_database_failure(monkeypatch,status,expect_cleanup):
    from fastapi import HTTPException
    storage_calls=[]
    async def request(method,path,**kwargs):
        storage_calls.append(method)
        return {'ok':True}
    async def rpc(*args,**kwargs):
        raise HTTPException(status,'serviceUnavailable' if status==503 else 'setupRequired')
    monkeypatch.setattr(db,'request',request)
    monkeypatch.setattr(db,'rpc',rpc)
    app.dependency_overrides[current_user]=lambda:USER
    image=BytesIO();Image.new('RGB',(10,10),'white').save(image,format='JPEG')
    try:
        with TestClient(app) as client:
            result=client.post('/consultations',data={'notes':'A question'},files={'image':('test.jpg',image.getvalue(),'image/jpeg')})
            assert result.status_code==status
            assert ('DELETE' in storage_calls)==expect_cleanup
    finally:
        app.dependency_overrides.clear()

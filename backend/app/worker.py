"""Run explicitly with `python -m app.worker` after campaigns are configured.

HTTP acceptance is recorded as sent; delivery/read receipts require a future
AiSensy webhook. Ambiguous sends are held for review instead of blindly retried.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo
import httpx
from .config import settings
from .db import db

ENDPOINT = 'https://backend.aisensy.com/campaign/t1/api/v2'


async def notification_payload(item, recipient):
    language = recipient['language']
    campaign = settings.aisensy_campaigns.get(item['kind'], {}).get(language)
    if not campaign:
        raise ValueError('Campaign not configured for recipient language')
    link = settings.public_site_url.rstrip('/')
    if item['kind'] == 'event_announcement':
        events = await db.rows('events',id=f'eq.{item["reference_id"]}',select='*',limit='1')
        if not events or not events[0]['published'] or datetime.fromisoformat(events[0]['starts_at'].replace('Z','+00:00')) <= datetime.now(timezone.utc):
            return None
        event = events[0]
        starts = datetime.fromisoformat(event['starts_at'].replace('Z','+00:00')).astimezone(ZoneInfo('Asia/Kolkata'))
        params = [recipient['name'],event['title'][language],starts.strftime('%d/%m/%Y %H:%M IST'),f'{link}/#events']
    elif item['kind'] == 'booking_confirmation':
        bookings = await db.rows('bookings',id=f'eq.{item["reference_id"]}',select='*,events(*)',limit='1')
        if not bookings or bookings[0]['status'] != 'confirmed':
            return None
        booking = bookings[0]
        params = [recipient['name'],booking['events']['title'][language],booking['id'],f'{link}/#dashboard']
    else:
        # Never put private Jatakam details or consultation responses in WhatsApp.
        params = [recipient['name'],f'{link}/#dashboard']
    return {'apiKey':settings.aisensy_api_key,'campaignName':campaign,'destination':recipient['phone'],
        'userName':recipient['name'],'source':'Ekatvam Seva','templateParams':params}


async def tick():
    # A process crash during a network call has an unknown external outcome.
    await db.patch('notifications', {'status':'failed','last_error':'Worker lease expired; inspect provider before retry'},
        status='eq.processing',next_attempt_at=f'lt.{datetime.now(timezone.utc).isoformat()}')
    items = await db.rpc('claim_notifications')
    for item in items:
        target = {'id':f'eq.{item["id"]}'}
        try:
            recipients = await db.rows('profiles',id=f'eq.{item["recipient_id"]}',select='*',limit='1')
            if not recipients or not recipients[0]['whatsapp_opt_in']:
                await db.patch('notifications',{'status':'cancelled'},**target)
                continue
            recipient = recipients[0]
            auth = await db.request('GET',f'/auth/v1/admin/users/{recipient["id"]}')
            if not auth.get('phone_confirmed_at'):
                await db.patch('notifications',{'status':'cancelled'},**target)
                continue
            payload = await notification_payload(item,recipient)
            if payload is None:
                await db.patch('notifications',{'status':'cancelled'},**target)
                continue
            # Recheck consent immediately before the external request.
            consent = await db.rows('profiles',id=f'eq.{recipient["id"]}',select='whatsapp_opt_in',limit='1')
            if not consent or not consent[0]['whatsapp_opt_in']:
                await db.patch('notifications',{'status':'cancelled'},**target)
                continue
            response = await db.client.post(ENDPOINT,json=payload)
            if response.status_code == 429:
                when = datetime.now(timezone.utc)+timedelta(minutes=2**item['attempts'])
                await db.patch('notifications',{'status':'queued' if item['attempts']<5 else 'failed','next_attempt_at':when.isoformat(),'last_error':'Provider rate limit'},**target)
            elif response.status_code == 200:
                await db.patch('notifications',{'status':'sent','last_error':None},**target)
            else:
                await db.patch('notifications',{'status':'failed','last_error':f'Provider HTTP {response.status_code}; review campaign/provider state'},**target)
        except (httpx.RequestError,ValueError):
            await db.patch('notifications',{'status':'failed','last_error':'Configuration error or ambiguous delivery; review before retry'},**target)


async def main():
    if not settings.configured or not settings.aisensy_api_key or not settings.aisensy_campaigns:
        raise SystemExit('Configure Supabase and AiSensy campaigns before running the notification worker.')
    await db.open()
    try:
        while True:
            try:
                await tick()
            except Exception:
                # Avoid logging PII, provider response bodies, or credentials.
                print('Notification queue unavailable; retrying in 10 seconds.')
            await asyncio.sleep(10)
    finally:
        await db.close()


if __name__ == '__main__':
    asyncio.run(main())

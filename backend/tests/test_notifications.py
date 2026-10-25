from datetime import datetime, timedelta, timezone
import pytest
from app import worker
from app.config import settings
from app.db import db


@pytest.mark.parametrize('language',['te','hi','en'])
def test_event_campaign_uses_recipient_language(monkeypatch,language):
    import asyncio
    monkeypatch.setattr(settings,'aisensy_campaigns',{'event_announcement':{language:f'event-{language}'}})
    async def rows(*args,**kwargs):
        return [{'published':True,'starts_at':(datetime.now(timezone.utc)+timedelta(days=1)).isoformat(),
            'title':{'te':'కార్యక్రమం','hi':'कार्यक्रम','en':'Event'}}]
    monkeypatch.setattr(db,'rows',rows)
    result=asyncio.run(worker.notification_payload({'kind':'event_announcement','reference_id':'test'},
        {'name':'Member','language':language,'phone':'+919876543210'}))
    assert result['campaignName']==f'event-{language}'
    assert result['templateParams'][1]=={'te':'కార్యక్రమం','hi':'कार्यक्रम','en':'Event'}[language]
    assert 'IST' in result['templateParams'][2]


def test_private_consultation_text_is_not_sent(monkeypatch):
    import asyncio
    monkeypatch.setattr(settings,'aisensy_campaigns',{'consultation_completed':{'te':'complete-te'}})
    result=asyncio.run(worker.notification_payload({'kind':'consultation_completed','reference_id':'test','response':'Private guidance'},
        {'name':'Member','language':'te','phone':'+919876543210'}))
    assert len(result['templateParams'])==2
    assert 'Private guidance' not in str(result)

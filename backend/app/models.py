from datetime import datetime, timezone
from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra='forbid', str_strip_whitespace=True)


class Preferences(StrictModel):
    language: Literal['te', 'hi', 'en']
    whatsapp_opt_in: bool
    available: bool = True


class TeamMember(StrictModel):
    phone: str = Field(pattern=r'^\+91[6-9]\d{9}$')


class Assignment(StrictModel):
    assigned_to: UUID


class Guidance(StrictModel):
    response: str = Field(min_length=1, max_length=10000)


class ServiceSettings(StrictModel):
    consultation_fee_paise: int = Field(ge=0, le=100000000)


class EventInput(StrictModel):
    title: dict[str, str]
    description: dict[str, str]
    venue: dict[str, str]
    starts_at: datetime
    fee_paise: int = Field(ge=0, le=100000000)
    capacity: int = Field(ge=1, le=100000)

    @field_validator('title', 'description', 'venue')
    @classmethod
    def complete_translations(cls, value, info):
        limit = 3000 if info.field_name == 'description' else 200
        if set(value) != {'te', 'hi', 'en'} or any(not text.strip() or len(text) > limit for text in value.values()):
            raise ValueError('Every supported language requires valid text')
        return {key: text.strip() for key, text in value.items()}

    @field_validator('starts_at')
    @classmethod
    def future_date(cls, value):
        if value.tzinfo is None or value <= datetime.now(timezone.utc):
            raise ValueError('A future date with a timezone is required')
        return value

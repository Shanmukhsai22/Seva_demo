from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore')
    supabase_url: str = ''
    supabase_service_role_key: str = ''
    cors_origins: list[str] = ['http://127.0.0.1:5173', 'http://localhost:5173']
    public_site_url: str = 'http://localhost:5173'
    aisensy_api_key: str = ''
    aisensy_campaigns: dict[str, dict[str, str]] = {}

    @property
    def configured(self) -> bool:
        return bool(self.supabase_url and self.supabase_service_role_key)


settings = Settings()

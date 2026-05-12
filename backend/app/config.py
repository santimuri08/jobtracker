# backend/app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://jobtrackr:jobtrackr@localhost:5432/jobtrackr"
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expires_in: int = 86400
    anthropic_api_key: str = ""

    # Phase 6: Voyage embeddings (powers /applications/{id}/similar)
    voyage_api_key: str = ""

    # Phase 7: Resend + email config
    resend_api_key: str = ""
    resend_from_email: str = "onboarding@resend.dev"
    email_test_recipient: str = ""
    # Phase 3: job search
    rapidapi_key: str = ""
    job_search_provider: str = "mock"
    job_search_default_country: str = "us"

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
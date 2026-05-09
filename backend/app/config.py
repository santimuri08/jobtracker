# backend/app/config.py
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    database_url: str = "postgresql://jobtrackr:jobtrackr@localhost:5432/jobtrackr"
    jwt_secret: str
    jwt_algorithm: str = "HS256"
    jwt_expires_in: int = 86400
    anthropic_api_key: str = ""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


settings = Settings()
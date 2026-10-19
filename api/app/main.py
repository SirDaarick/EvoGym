from fastapi import FastAPI

from app.settings import Settings, get_settings


def create_app(settings: Settings | None = None) -> FastAPI:
    configuration = settings or get_settings()
    docs_url = "/docs" if configuration.docs_enabled else None
    redoc_url = "/redoc" if configuration.docs_enabled else None
    openapi_url = "/openapi.json" if configuration.docs_enabled else None

    return FastAPI(
        title="EvoGym API",
        version="0.1.0",
        debug=configuration.debug,
        docs_url=docs_url,
        redoc_url=redoc_url,
        openapi_url=openapi_url,
    )


app = create_app()
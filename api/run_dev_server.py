import sys
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlsplit, parse_qs
import uvicorn

api_dir = Path(__file__).resolve().parent
if str(api_dir) not in sys.path:
    sys.path.insert(0, str(api_dir))

from app.main import create_app
from app.settings import Settings
from app.auth.admin import approve_admin_login

db_file = api_dir / "dev.db"
db_url = f"sqlite+pysqlite:///{db_file.as_posix()}"

settings = Settings(
    environment="test",
    debug=False,
    database_url=db_url,
    admin_token_signing_secret="dev-secret-at-least-32-chars-long-here-1234",
    admin_session_ttl_seconds=28800,
    staff_session_ttl_seconds=28800,
    admin_lockout_attempts=5,
    admin_lockout_seconds=300,
    auth_rate_limit_window_seconds=60,
    auth_rate_limit_requests=1000,
    auth_request_max_bytes=8192,
    auth_max_concurrent_hashes=4,
    admin_recovery_ttl_seconds=1800,
    admin_recovery_base_url="http://localhost:5174/admin/recovery",
    cors_allowed_origins="http://localhost:5173,http://localhost:5174,http://127.0.0.1:5173,http://127.0.0.1:5174",
    _env_file=None
)

class DevDelivery:
    def __init__(self):
        self.app = None

    def enqueue_admin_device_approval(self, email, link):
        print(f"[DEV] Admin login approval link: {link}")
        qs = parse_qs(urlsplit(link).query)
        token = qs.get("approval_token", [None])[0]
        if token and self.app and getattr(self.app.state, "session_factory", None):
            approve_admin_login(self.app.state.session_factory, token, uuid4())
            print("[DEV] Automatically approved admin device login.")

    def enqueue_admin_security_notice(self, email, category):
        pass

    def enqueue_recovery_link(self, email, link):
        pass

delivery = DevDelivery()
app = create_app(settings, recovery_delivery=delivery)
delivery.app = app

if __name__ == "__main__":
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")

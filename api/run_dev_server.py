import os
import sys
from pathlib import Path
from uuid import uuid4
from urllib.parse import urlsplit, parse_qs
import uvicorn

api_dir = Path(__file__).resolve().parent
if str(api_dir) not in sys.path:
    sys.path.insert(0, str(api_dir))

from app.main import create_app
from app.settings import get_settings
from app.auth.admin import approve_admin_login

settings = get_settings()

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
    port = int(os.environ.get("PORT", 8080))
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")

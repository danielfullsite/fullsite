import importlib.util
import ssl
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
MODULE_PATH = ROOT / "scripts/onboarding/smoke_test.py"


def load_smoke_module():
    spec = importlib.util.spec_from_file_location("fullsite_onboarding_smoke", MODULE_PATH)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_smoke_http_uses_a_verifying_tls_context(monkeypatch):
    smoke = load_smoke_module()
    captured = {}

    class Response:
        status = 200

        def read(self):
            return b"[]"

        def __enter__(self):
            return self

        def __exit__(self, *_args):
            return False

    def fake_urlopen(_request, **kwargs):
        captured.update(kwargs)
        return Response()

    monkeypatch.setattr(smoke.urllib.request, "urlopen", fake_urlopen)
    status, body = smoke._req("GET", "https://staging.invalid/rest/v1/clients", {})

    assert status == 200
    assert body == []
    assert captured["context"] is smoke._SSL_CONTEXT
    assert smoke._SSL_CONTEXT.verify_mode == ssl.CERT_REQUIRED
    assert smoke._SSL_CONTEXT.check_hostname is True


def test_smoke_order_coordinates_match_numeric_production_columns():
    smoke = load_smoke_module()

    assert isinstance(smoke.SMOKE_MESA, int)
    assert isinstance(smoke.SMOKE_ORDER_NUMBER, int)
    assert smoke.SMOKE_MESA > 0
    assert smoke.SMOKE_ORDER_NUMBER > 0

"""HTTP Interceptor — captures XHR/Fetch/API requests made by the Wansoft frontend."""

import json
from dataclasses import dataclass, field, asdict
from datetime import datetime


@dataclass
class CapturedRequest:
    method: str
    url: str
    status: int | None = None
    resource_type: str = ""
    request_body: str | None = None
    response_keys: list[str] = field(default_factory=list)
    timestamp: str = ""


class HTTPInterceptor:
    """Registers Playwright event listeners to capture network traffic."""

    def __init__(self):
        self._captured: list[CapturedRequest] = []

    _SKIP_EXTENSIONS = {
        ".png", ".jpg", ".jpeg", ".gif", ".svg", ".css", ".woff",
        ".woff2", ".ttf", ".ico", ".mp4", ".webp",
    }
    _SKIP_DOMAINS = {
        "google.com", "googletagmanager.com", "google-analytics.com",
        "nr-data.net", "zdassets.com", "facebook.net", "doubleclick.net",
    }

    def setup(self, page):
        """Register request/response listeners on a Playwright page."""
        page.on("request", self._on_request)
        page.on("response", self._on_response)

    def _should_skip(self, url: str) -> bool:
        lower = url.lower()
        if any(lower.endswith(ext) for ext in self._SKIP_EXTENSIONS):
            return True
        if any(domain in lower for domain in self._SKIP_DOMAINS):
            return True
        return False

    def _on_request(self, request):
        url = request.url
        if self._should_skip(url):
            return

        rtype = request.resource_type
        # Capture: XHR, Fetch, and document POSTs (ASP.NET form submissions)
        if rtype in ("xhr", "fetch") or (rtype == "document" and request.method == "POST"):
            body = None
            try:
                body = request.post_data
            except Exception:
                pass

            entry = CapturedRequest(
                method=request.method,
                url=url,
                resource_type=rtype,
                request_body=body,
                timestamp=datetime.now().isoformat(),
            )
            self._captured.append(entry)

    def _on_response(self, response):
        url = response.url
        status = response.status

        for entry in reversed(self._captured):
            if entry.url == url and entry.status is None:
                entry.status = status
                break

    def get_captured(self) -> list[CapturedRequest]:
        return list(self._captured)

    def filter_xhr_only(self) -> list[CapturedRequest]:
        return [r for r in self._captured if r.resource_type in ("xhr", "fetch")]

    def get_unique_urls(self) -> list[str]:
        seen = set()
        result = []
        for r in self._captured:
            if r.url not in seen:
                seen.add(r.url)
                result.append(r.url)
        return result

    def dump_json(self, path: str):
        data = [asdict(r) for r in self._captured]
        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, indent=2, ensure_ascii=False)
        print(f"  [interceptor] Dumped {len(data)} requests to {path}")

    def clear(self):
        self._captured.clear()

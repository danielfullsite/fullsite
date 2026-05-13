"""Screenshot utilities."""

import os


async def take_screenshot(page, path: str):
    """Take a full-page screenshot."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    await page.screenshot(path=path, full_page=True)

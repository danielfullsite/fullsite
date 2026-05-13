"""Crawler — systematic navigation of Wansoft portal menu."""

import asyncio
import json
import os
import re
from dataclasses import dataclass, field, asdict


def slugify(text: str) -> str:
    """Convert text to filesystem-safe slug."""
    text = text.lower().strip()
    text = re.sub(r'[áàä]', 'a', text)
    text = re.sub(r'[éèë]', 'e', text)
    text = re.sub(r'[íìï]', 'i', text)
    text = re.sub(r'[óòö]', 'o', text)
    text = re.sub(r'[úùü]', 'u', text)
    text = re.sub(r'[ñ]', 'n', text)
    text = re.sub(r'[^a-z0-9]+', '-', text)
    return text.strip('-')


@dataclass
class MenuItem:
    path: str
    parent_path: str | None
    level: int
    ui_label: str
    ui_selector: str
    href: str | None = None
    screenshot_path: str = ""
    has_export: bool = False
    export_format: str = ""
    endpoints: list[dict] = field(default_factory=list)
    filters: list[dict] = field(default_factory=list)
    item_type: str = "menu"
    notes: str = ""
    xlsx_sample_path: str = ""
    xlsx_sheets: list = field(default_factory=list)


THROTTLE_SEC = 2.5
BASE_URL = "https://www.wansoft.net/Wansoft.Web"


async def crawl_menu(page, interceptor, output_dir: str = "output") -> list[MenuItem]:
    """
    Crawl the Wansoft sidebar menu by:
    1. Extracting the full menu tree from sidebar HTML (one shot)
    2. Navigating to each page with a real href
    3. Capturing screenshots + XHR endpoints + export buttons
    """
    screenshots_dir = os.path.join(output_dir, "screenshots")
    os.makedirs(screenshots_dir, exist_ok=True)

    # Phase 1: Extract menu tree from sidebar DOM
    print("\n[crawler] === Phase 1: Extracting menu tree from sidebar ===")
    raw_items = await _extract_menu_tree(page)
    print(f"[crawler] Found {len(raw_items)} total items in sidebar")

    # Separate navigable items (have href) from category headers
    navigable = [i for i in raw_items if i["href"]]
    categories = [i for i in raw_items if not i["href"]]
    print(f"[crawler] Navigable pages: {len(navigable)}")
    print(f"[crawler] Category headers: {len(categories)}")

    all_items: list[MenuItem] = []

    # Add category items (no navigation needed)
    for cat in categories:
        item = MenuItem(
            path=cat["path"],
            parent_path=cat["parentPath"],
            level=cat["level"],
            ui_label=cat["label"],
            ui_selector=f'a:has-text("{cat["label"]}")',
            item_type="menu",
        )
        all_items.append(item)

    # Load previously crawled items if resuming
    prev_items = _load_previous_results(output_dir)
    prev_paths = {item["path"] for item in prev_items}

    # Phase 2: Navigate to each page
    skipped = 0
    print(f"\n[crawler] === Phase 2: Visiting {len(navigable)} pages ===")
    if prev_paths:
        print(f"[crawler] Resuming — {len(prev_paths)} pages already crawled")
    for i, raw in enumerate(navigable):
        slug = slugify(raw["path"].replace("/", "-"))
        screenshot_path = f"screenshots/{slug}.png"
        full_screenshot = os.path.join(screenshots_dir, f"{slug}.png")

        # Skip if already crawled in a previous run
        if raw["path"] in prev_paths:
            # Re-add the previous result
            for prev in prev_items:
                if prev["path"] == raw["path"]:
                    item = MenuItem(**{k: v for k, v in prev.items() if k in MenuItem.__dataclass_fields__})
                    all_items.append(item)
                    break
            skipped += 1
            continue

        print(f"[crawler] ({i + 1}/{len(navigable)}) {raw['path']}")

        # Clear interceptor
        interceptor.clear()

        # Navigate to the page
        url = raw["href"]
        if not url.startswith("http"):
            url = BASE_URL + url

        try:
            await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(THROTTLE_SEC)
        except Exception as e:
            print(f"[crawler]   SKIP (nav error): {e}")
            item = MenuItem(
                path=raw["path"], parent_path=raw["parentPath"],
                level=raw["level"], ui_label=raw["label"],
                ui_selector=f'a[href*="{raw["href"].split("/")[-1]}"]',
                href=raw["href"], notes=f"Navigation error: {e}",
            )
            all_items.append(item)
            continue

        # Screenshot
        try:
            await page.screenshot(path=full_screenshot)
        except Exception:
            pass

        # Capture endpoints
        captured = interceptor.get_captured()
        endpoints = []
        for req in captured:
            req_url = req.url
            if "/Wansoft.Web/" in req_url:
                rel = req_url.split("/Wansoft.Web/")[-1].split("?")[0]
                params = []
                if "?" in req_url:
                    param_str = req_url.split("?")[1]
                    params = [p.split("=")[0] for p in param_str.split("&")]
                endpoints.append({
                    "method": req.method,
                    "url": f"/Wansoft.Web/{rel}",
                    "params": params,
                    "response_keys": req.response_keys,
                })

        # Detect export buttons
        has_export = False
        export_format = ""
        for esel in [
            'a:has-text("Excel")', 'button:has-text("Excel")',
            'a:has-text("Exportar")', 'button:has-text("Exportar")',
            'input[value*="Excel"]', 'input[value*="Exportar"]',
            '#btnExport', '.btn-export', 'a[href*="Export"]',
            'a:has-text("Descargar")', 'a:has-text("CSV")',
        ]:
            try:
                eel = page.locator(esel).first
                if await eel.is_visible(timeout=500):
                    has_export = True
                    export_format = "xlsx"
                    break
            except Exception:
                continue

        # Detect filters
        filters = await _detect_filters(page)

        # Determine item type
        item_type = _classify_item(raw["label"], raw["path"], has_export, endpoints)

        # Build selector
        href_part = raw["href"].split("/")[-1].rstrip("/")
        selector = f'a[href*="{href_part}"]' if href_part else f'a:has-text("{raw["label"]}")'

        item = MenuItem(
            path=raw["path"],
            parent_path=raw["parentPath"],
            level=raw["level"],
            ui_label=raw["label"],
            ui_selector=selector,
            href=raw["href"],
            screenshot_path=screenshot_path,
            has_export=has_export,
            export_format=export_format,
            endpoints=endpoints,
            filters=filters,
            item_type=item_type,
        )
        all_items.append(item)

        ep_count = len(endpoints)
        exp_tag = " [EXPORT]" if has_export else ""
        flt_tag = f" [{len(filters)} filters]" if filters else ""
        print(f"[crawler]   -> {item_type} | {ep_count} endpoints{exp_tag}{flt_tag}")

    if skipped:
        print(f"[crawler] Skipped {skipped} previously crawled pages")
    print(f"\n[crawler] === Crawl complete: {len(all_items)} items ===")
    return all_items


async def _extract_menu_tree(page) -> list[dict]:
    """Extract the complete menu tree from the sidebar DOM in one shot."""
    return await page.evaluate('''() => {
        const items = [];
        const sidebar = document.querySelector('#leftsidebar .menu ul.list');
        if (!sidebar) return items;

        function extractItems(ul, parentPath, level) {
            const children = ul.querySelectorAll(':scope > li');
            children.forEach(li => {
                const a = li.querySelector(':scope > a');
                if (!a) return;
                const span = a.querySelector('span');
                const text = span ? span.textContent.trim() : a.textContent.trim();
                const href = a.getAttribute('href') || '';
                if (!text || text.length > 60) return;
                if (href.includes('facebook') || href.includes('linkedin') || href.includes('instagram')) return;

                const path = parentPath ? parentPath + '/' + text : text;
                const hasHref = href.includes('/Wansoft.Web/') && !href.includes('javascript:');

                items.push({
                    path: path,
                    label: text,
                    href: hasHref ? href : null,
                    level: level,
                    parentPath: parentPath || null
                });

                const subMenu = li.querySelector(':scope > ul.ml-menu');
                if (subMenu) {
                    extractItems(subMenu, path, level + 1);
                }
            });
        }

        extractItems(sidebar, null, 1);
        return items;
    }''')


async def _detect_filters(page) -> list[dict]:
    """Detect filter inputs on the current page."""
    filters = []
    filter_inputs = await page.query_selector_all(
        'input[type="date"], input[name*="Date" i], input[name*="fecha" i], '
        'select:not([style*="display: none"]), input[name*="From" i], input[name*="To" i]'
    )
    for fi in filter_inputs[:10]:
        try:
            if not await fi.is_visible():
                continue
            fname = await fi.get_attribute("name") or await fi.get_attribute("id") or ""
            ftype = await fi.get_attribute("type") or "select"
            tag = await fi.evaluate("el => el.tagName.toLowerCase()")
            if tag == "select":
                ftype = "select"
            if fname:
                filters.append({"name": fname, "type": ftype, "default_value": ""})
        except Exception:
            continue
    return filters


def _classify_item(label: str, path: str, has_export: bool, endpoints: list) -> str:
    """Classify a menu item by type."""
    lower_label = label.lower()
    lower_path = path.lower()

    if any(kw in lower_label for kw in ["dashboard", "escritorio", "monitor"]):
        return "dashboard"
    if any(kw in lower_label for kw in ["configuración", "config", "usuarios", "perfil"]):
        return "form"
    if any(kw in lower_label for kw in ["reporte", "report", "corte", "histórico", "ventas",
                                         "compras", "costos", "costo", "cardex", "existencias",
                                         "estado de", "auditoría"]):
        return "report"
    if has_export:
        return "report"
    if any(kw in lower_label for kw in ["emitir", "nuevo", "crear", "hacer", "registrar"]):
        return "form"
    if endpoints:
        return "report"
    return "menu"


def _load_previous_results(output_dir: str) -> list[dict]:
    """Load previously crawled results if they exist (for resume)."""
    path = os.path.join(output_dir, "crawl_results.json")
    if os.path.exists(path):
        try:
            with open(path, "r", encoding="utf-8") as f:
                data = json.load(f)
            # Only return navigable items (those with href)
            return [d for d in data if d.get("href")]
        except Exception:
            return []
    return []


def save_items(items: list[MenuItem], output_dir: str = "output"):
    """Save crawled items to JSON."""
    path = os.path.join(output_dir, "crawl_results.json")
    data = [asdict(item) for item in items]
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[crawler] Saved {len(data)} items to {path}")

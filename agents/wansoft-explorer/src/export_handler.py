"""Export handler — download XLSX files and extract schema info."""

import asyncio
import json
import os

from openpyxl import load_workbook

from .crawler import MenuItem, slugify


async def download_exports(page, items: list[MenuItem], output_dir: str = "output") -> dict:
    """
    For each item with has_export=True, click the export button,
    download the XLSX, and extract schema info.

    Returns xlsx_schemas dict.
    """
    xlsx_dir = os.path.join(output_dir, "xlsx_samples")
    os.makedirs(xlsx_dir, exist_ok=True)

    schemas = {}
    export_items = [item for item in items if item.has_export]
    print(f"\n[export] === Paso 5: Downloading exports for {len(export_items)} items ===")

    for i, item in enumerate(export_items):
        print(f"[export] ({i + 1}/{len(export_items)}) {item.path}")

        try:
            # Navigate directly to the item's page by URL
            url = item.href
            if not url:
                print(f"[export]   SKIP: no href")
                continue
            if not url.startswith("http"):
                url = "https://www.wansoft.net/Wansoft.Web" + url

            await page.goto(url, wait_until="domcontentloaded", timeout=15000)
            await asyncio.sleep(2)

            # Try to set date filters if present (default: today or last 7 days)
            await _try_set_date_filters(page)

            # Find and click the export button
            export_selectors = [
                'a:has-text("Excel")', 'a:has-text("Exportar")', 'a:has-text("Export")',
                'button:has-text("Excel")', 'button:has-text("Exportar")',
                'input[value*="Excel"]', 'input[value*="Exportar"]',
                '#btnExport', '.btn-export', 'a[href*="Export"]',
                'a:has-text("Descargar")', 'button:has-text("Descargar")',
            ]

            export_btn = None
            for esel in export_selectors:
                try:
                    eel = page.locator(esel).first
                    if await eel.is_visible(timeout=1000):
                        export_btn = eel
                        break
                except Exception:
                    continue

            if not export_btn:
                print(f"[export]   SKIP: no export button found on page")
                item.has_export = False
                continue

            # Download the file
            slug = slugify(item.path.replace("/", "-"))
            file_path = os.path.join(xlsx_dir, f"{slug}.xlsx")

            try:
                async with page.expect_download(timeout=30000) as download_info:
                    await export_btn.click()
                download = await download_info.value
                await download.save_as(file_path)
                print(f"[export]   Downloaded: {file_path}")
            except Exception as e:
                print(f"[export]   DOWNLOAD FAILED: {e}")
                item.notes += f" Export download failed: {e}"
                continue

            # Parse XLSX schema
            schema = _parse_xlsx_schema(file_path)
            if schema:
                item.xlsx_sample_path = f"xlsx_samples/{slug}.xlsx"
                schemas[item.path] = {
                    "file_path": item.xlsx_sample_path,
                    "sheets": schema,
                }
                cols_count = sum(len(s.get("columns", [])) for s in schema)
                print(f"[export]   Schema: {len(schema)} sheets, {cols_count} total columns")

            await asyncio.sleep(2)

        except Exception as e:
            print(f"[export]   ERROR: {e}")
            item.notes += f" Export error: {e}"
            continue

    # Save schemas
    schemas_path = os.path.join(output_dir, "xlsx_schemas.json")
    with open(schemas_path, "w", encoding="utf-8") as f:
        json.dump(schemas, f, indent=2, ensure_ascii=False)
    print(f"\n[export] Saved {len(schemas)} schemas to {schemas_path}")

    return schemas


async def _try_set_date_filters(page):
    """Try to set date filters to today or last 7 days."""
    try:
        # Look for date inputs and try to fill them
        date_inputs = page.locator('input[type="date"], input[name*="Date" i], input[name*="fecha" i]')
        count = await date_inputs.count()
        if count > 0:
            from datetime import date, timedelta
            today = date.today().isoformat()
            week_ago = (date.today() - timedelta(days=7)).isoformat()

            if count >= 2:
                # Assume first is "from", second is "to"
                try:
                    await date_inputs.nth(0).fill(week_ago)
                    await date_inputs.nth(1).fill(today)
                except Exception:
                    pass
            elif count == 1:
                try:
                    await date_inputs.nth(0).fill(today)
                except Exception:
                    pass

            # Click any "search" or "consultar" button to apply filters
            search_selectors = [
                'button:has-text("Buscar")', 'button:has-text("Consultar")',
                'input[value*="Buscar"]', 'input[value*="Consultar"]',
                'button[type="submit"]',
            ]
            for sel in search_selectors:
                try:
                    btn = page.locator(sel).first
                    if await btn.is_visible(timeout=500):
                        await btn.click()
                        await asyncio.sleep(2)
                        break
                except Exception:
                    continue
    except Exception:
        pass


def _parse_xlsx_schema(file_path: str) -> list[dict] | None:
    """Extract schema from an XLSX file."""
    try:
        wb = load_workbook(file_path, read_only=True, data_only=True)
        sheets = []
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            rows = list(ws.iter_rows(max_row=4, values_only=True))
            if not rows:
                continue

            # First row = headers
            columns = [str(c) if c is not None else "" for c in rows[0]]
            columns = [c for c in columns if c]

            # Sample row (first data row)
            sample_row = []
            if len(rows) > 1:
                sample_row = [_serialize_cell(c) for c in rows[1][:len(columns)]]

            sheets.append({
                "name": sheet_name,
                "columns": columns,
                "sample_row": sample_row,
            })

        wb.close()
        return sheets if sheets else None
    except Exception as e:
        print(f"[export]   XLSX parse error: {e}")
        return None


def _serialize_cell(value):
    """Convert cell value to JSON-serializable form."""
    if value is None:
        return None
    if isinstance(value, (int, float, str, bool)):
        return value
    return str(value)

#!/usr/bin/env python3
"""Exploración SOLO-LECTURA de la pantalla Production/SaucerRecipe.

Objetivo: descubrir el endpoint y payload de guardado de recetas SIN ejecutarlo.
Candado: se aborta cualquier POST que no sea de lectura (Get*/login).
Artifacts en output/recipe_form/.
"""

import asyncio
import json
import os
import re
import sys

from dotenv import load_dotenv
from playwright.async_api import async_playwright

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from src.auth import login  # noqa: E402

PAGE_URL = "https://www.wansoft.net/Wansoft.Web/Production/SaucerRecipe"
OUT = "output/recipe_form"
TARGET_NAME = "BOTE DE OATMEAL"  # platillo sin receta — solo lo seleccionamos (lectura)

xhr_log = []
blocked = []


def is_read_only(method: str, url: str) -> bool:
    if method == "GET":
        return True
    # POSTs permitidos: Get*/List* (lecturas), login (postea a la raíz de Wansoft.Web)
    if re.search(r"/(Get|List)[A-Za-z]*|/Account/|/Login", url):
        return True
    return url.rstrip("/") in ("https://www.wansoft.net/Wansoft.Web",)


async def main():
    load_dotenv()
    os.makedirs(OUT, exist_ok=True)
    user = os.environ["WANSOFT_USER"]
    password = os.environ["WANSOFT_PASS"]

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        ctx = await browser.new_context()
        page = await ctx.new_page()

        # ── Candado: bloquear todo write ──
        async def guard(route):
            req = route.request
            if not is_read_only(req.method, req.url):
                blocked.append({"method": req.method, "url": req.url, "post": (req.post_data or "")[:500]})
                print(f"[GUARD] BLOQUEADO {req.method} {req.url}")
                await route.abort()
            else:
                await route.continue_()

        await ctx.route("**/*", guard)

        # ── Log de XHR/fetch ──
        def on_request(req):
            if req.resource_type in ("xhr", "fetch"):
                xhr_log.append({"method": req.method, "url": req.url, "post": (req.post_data or "")[:2000]})
                print(f"[XHR] {req.method} {req.url}")

        page.on("request", on_request)

        ok = await login(page, "", user, password)
        if not ok:
            print("LOGIN FAILED")
            return

        print(f"\n[nav] {PAGE_URL}")
        await page.goto(PAGE_URL, wait_until="domcontentloaded", timeout=30000)
        try:
            await page.wait_for_load_state("networkidle", timeout=20000)
        except Exception:
            pass
        await asyncio.sleep(3)
        await page.screenshot(path=f"{OUT}/01-recipe-page.png", full_page=True)
        with open(f"{OUT}/01-recipe-page.html", "w") as f:
            f.write(await page.content())

        # ── Inventario de controles ──
        controls = await page.evaluate("""() => {
          const out = {selects: [], inputs: [], buttons: [], links: []};
          document.querySelectorAll('select').forEach(s => out.selects.push({id: s.id, name: s.name, options: s.options.length, cls: s.className.slice(0,80)}));
          document.querySelectorAll('input').forEach(i => out.inputs.push({id: i.id, name: i.name, type: i.type, placeholder: i.placeholder, cls: i.className.slice(0,80)}));
          document.querySelectorAll('button, input[type=button], input[type=submit], a.btn, [onclick]').forEach(b => out.buttons.push({tag: b.tagName, id: b.id, text: (b.innerText||b.value||'').trim().slice(0,60), onclick: (b.getAttribute('onclick')||'').slice(0,120)}));
          return out;
        }""")
        with open(f"{OUT}/controls.json", "w") as f:
            json.dump(controls, f, indent=2, ensure_ascii=False)
        print(f"\n[controls] selects={len(controls['selects'])} inputs={len(controls['inputs'])} buttons={len(controls['buttons'])}")

        # ── Scripts: buscar endpoints de guardado ──
        scripts = await page.evaluate("""() => ({
          srcs: [...document.querySelectorAll('script[src]')].map(s => s.src),
          inline: [...document.querySelectorAll('script:not([src])')].map(s => s.textContent),
        })""")
        save_hits = []
        pat = re.compile(r"['\"](/?Wansoft\.Web)?/?\w*/(Save|Add|Update|Insert|Set|Create|Delete|Remove)\w*['\"]|url\s*:\s*['\"][^'\"]+['\"]", re.I)
        for i, code in enumerate(scripts["inline"]):
            for m in pat.finditer(code or ""):
                ctx_s = (code[max(0, m.start() - 200):m.end() + 200]).strip()
                save_hits.append({"where": f"inline[{i}]", "match": m.group(0), "context": ctx_s})
        # JS externos del mismo dominio
        for src in scripts["srcs"]:
            if "wansoft" not in src.lower():
                continue
            try:
                body = await page.evaluate("u => fetch(u).then(r => r.text())", src)
            except Exception as e:
                print(f"[js] error {src}: {e}")
                continue
            if re.search(r"Recipe|Receta", body, re.I):
                with open(f"{OUT}/js_{os.path.basename(src).split('?')[0]}", "w") as f:
                    f.write(body)
                for m in re.finditer(r"(Save|Add|Update|Insert|Set|Create|Delete|Remove)\w*Recipe\w*|Recipe\w*(Save|Add|Update)|['\"][^'\"]*\/(Save|Add|Update|Insert|Set|Delete)\w+['\"]", body, re.I):
                    ctx_s = body[max(0, m.start() - 250):m.end() + 250].strip()
                    save_hits.append({"where": src, "match": m.group(0), "context": ctx_s})
        with open(f"{OUT}/save_hits.json", "w") as f:
            json.dump(save_hits, f, indent=2, ensure_ascii=False)
        print(f"[js] {len(save_hits)} hits de posibles endpoints de escritura")

        # ── Intentar seleccionar el platillo (solo dispara lecturas) ──
        try:
            sel2 = page.locator(".select2-container, .select2-selection").first
            if await sel2.is_visible(timeout=3000):
                await sel2.click()
                await asyncio.sleep(1)
                box = page.locator("input.select2-search__field, .select2-input").first
                await box.fill(TARGET_NAME)
                await asyncio.sleep(3)
                await page.screenshot(path=f"{OUT}/02-search.png", full_page=True)
                opt = page.locator(".select2-results li, .select2-results__option").first
                if await opt.is_visible(timeout=3000):
                    await opt.click()
                    await asyncio.sleep(4)
                    await page.screenshot(path=f"{OUT}/03-selected.png", full_page=True)
                    with open(f"{OUT}/03-selected.html", "w") as f:
                        f.write(await page.content())
                    print("[select] platillo seleccionado")
        except Exception as e:
            print(f"[select] no pude seleccionar via select2: {e} — revisar controls.json")
            await page.screenshot(path=f"{OUT}/02-fail.png", full_page=True)

        with open(f"{OUT}/xhr_log.json", "w") as f:
            json.dump(xhr_log, f, indent=2, ensure_ascii=False)
        with open(f"{OUT}/blocked.json", "w") as f:
            json.dump(blocked, f, indent=2, ensure_ascii=False)
        print(f"\n[done] xhr={len(xhr_log)} blocked={len(blocked)} -> {OUT}/")
        await browser.close()


if __name__ == "__main__":
    asyncio.run(main())

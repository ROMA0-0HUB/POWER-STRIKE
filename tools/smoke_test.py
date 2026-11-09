#!/usr/bin/env python3
"""Headless smoke test: loads the game, plays a short match and checks the
results screen appears without JavaScript errors.

Usage:
  python3 -m http.server 8765 &     # from the project root
  pip install playwright && python3 -m playwright install chromium
  python3 tools/smoke_test.py http://localhost:8765/index.html
"""
import json
import sys

from playwright.sync_api import sync_playwright

URL = sys.argv[1] if len(sys.argv) > 1 else "http://localhost:8765/index.html"
SAVE = {
    "profile": {"name": "Test"},
    "characterId": "kaito",
    # 5-second match, no golden goal, easy bots, small teams, low quality
    "settings": {"duration": 5, "goldenGoal": False, "difficulty": "easy", "teamSize": 3, "quality": "low"},
}

errors = []
with sync_playwright() as p:
    browser = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-webgl", "--ignore-gpu-blocklist"])
    page = browser.new_page(viewport={"width": 844, "height": 390})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(URL, wait_until="load")
    page.evaluate("s => localStorage.setItem('power-striker:v1', JSON.stringify(s))", SAVE)
    page.reload(wait_until="load")
    page.wait_for_timeout(800)
    page.click("text=العب")
    page.click("#kick")
    page.wait_for_function("document.getElementById('resTitle').textContent.length > 0", timeout=180000)
    print("result:", page.evaluate("document.getElementById('resTitle').textContent"))
    browser.close()

if errors:
    print("FAILED - page errors:\n" + "\n".join(errors))
    sys.exit(1)
print("OK - no page errors")

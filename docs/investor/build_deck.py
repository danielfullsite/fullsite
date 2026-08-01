#!/usr/bin/env python3
"""
Fullsite Pitch Deck — Hi Ventures
Minimalist, dark theme, investor-grade PDF
"""
from reportlab.lib.pagesizes import landscape
from reportlab.lib.units import inch, mm
from reportlab.lib.colors import HexColor, white, Color
from reportlab.pdfgen import canvas
from reportlab.lib.enums import TA_LEFT, TA_CENTER, TA_RIGHT
from reportlab.platypus import Paragraph, Frame
from reportlab.lib.styles import ParagraphStyle

# Page size: 16:9 widescreen
W, H = 13.333 * inch, 7.5 * inch

# Colors
BG = HexColor('#0a0a0a')
BG2 = HexColor('#111111')
ACCENT = HexColor('#10b981')
WHITE = white
GRAY = HexColor('#888888')
LIGHT_GRAY = HexColor('#cccccc')
DARK_GRAY = HexColor('#1a1a1a')
MID_GRAY = HexColor('#333333')

# Output
OUTPUT = '/Users/danielrg/fullsite/docs/investor/fullsite-hi-ventures-deck.pdf'

def bg(c, color=BG):
    c.setFillColor(color)
    c.rect(0, 0, W, H, fill=1, stroke=0)

def accent_line(c, x, y, w, h=3):
    c.setFillColor(ACCENT)
    c.rect(x, y, w, h, fill=1, stroke=0)

def text(c, x, y, txt, size=14, color=WHITE, font='Helvetica'):
    c.setFont(font, size)
    c.setFillColor(color)
    c.drawString(x, y, txt)

def text_center(c, y, txt, size=14, color=WHITE, font='Helvetica'):
    c.setFont(font, size)
    c.setFillColor(color)
    tw = c.stringWidth(txt, font, size)
    c.drawString((W - tw) / 2, y, txt)

def text_right(c, x, y, txt, size=14, color=WHITE, font='Helvetica'):
    c.setFont(font, size)
    c.setFillColor(color)
    tw = c.stringWidth(txt, font, size)
    c.drawString(x - tw, y, txt)

def wrap_text(c, x, y, txt, size=14, color=WHITE, font='Helvetica', max_width=None, leading=None):
    if leading is None:
        leading = size * 1.5
    if max_width is None:
        max_width = W - 2 * inch
    words = txt.split(' ')
    lines = []
    current = ''
    c.setFont(font, size)
    for w in words:
        test = current + (' ' if current else '') + w
        if c.stringWidth(test, font, size) > max_width:
            lines.append(current)
            current = w
        else:
            current = test
    if current:
        lines.append(current)
    for i, line in enumerate(lines):
        c.setFillColor(color)
        c.drawString(x, y - i * leading, line)
    return len(lines)

def bullet(c, x, y, items, size=13, color=LIGHT_GRAY, leading=24):
    for i, item in enumerate(items):
        yy = y - i * leading
        c.setFillColor(ACCENT)
        c.circle(x + 4, yy + 4, 3, fill=1, stroke=0)
        c.setFont('Helvetica', size)
        c.setFillColor(color)
        c.drawString(x + 16, yy, item)

def table_row(c, x, y, cols, widths, size=11, color=WHITE, font='Helvetica', bg_color=None):
    if bg_color:
        total_w = sum(widths)
        c.setFillColor(bg_color)
        c.rect(x, y - 6, total_w, 22, fill=1, stroke=0)
    cx = x
    for i, col in enumerate(cols):
        c.setFont(font, size)
        c.setFillColor(color)
        c.drawString(cx + 8, y, str(col))
        cx += widths[i]

def slide_number(c, num, total=21):
    text_right(c, W - 0.5*inch, 0.4*inch, f'{num}', size=9, color=GRAY)

# ═══════════════════════════════════════════════════════════
c = canvas.Canvas(OUTPUT, pagesize=(W, H))
c.setTitle('Fullsite — Pre-Seed Pitch Deck')
c.setAuthor('Daniel Ramonfaur')

# ═══ SLIDE 1: COVER ═══
bg(c)
accent_line(c, W/2 - 1.5*inch, H/2 + 0.6*inch, 3*inch, 3)
text_center(c, H/2 + 0.2*inch, 'fullsite', size=52, font='Helvetica-Bold', color=WHITE)
text_center(c, H/2 - 0.4*inch, 'The restaurant that runs itself.', size=18, color=GRAY)
text_center(c, 1.2*inch, 'Pre-Seed  |  Julio 2026', size=12, color=GRAY)
c.showPage()

# ═══ SLIDE 2: PROBLEM ═══
bg(c)
slide_number(c, 2)
text(c, 1*inch, H - 1.2*inch, 'THE PROBLEM', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 0.8*inch)
wrap_text(c, 1*inch, H - 1.9*inch,
    'Restaurants discover operational problems too late.',
    size=32, font='Helvetica-Bold', max_width=9*inch)

text(c, 1*inch, H - 3.2*inch, '80% of restaurants fail within 2 years.', size=16, color=ACCENT, font='Helvetica-Bold')

bullet(c, 1*inch, H - 3.9*inch, [
    'The #1 cause is not bad food — it\'s invisible operational bleeding',
    'Waste, fraud, poor purchasing, labor inefficiency, menu mispricing',
    'By the time the owner sees the problem in a report, the money is already gone',
], size=14, leading=30)
c.showPage()

# ═══ SLIDE 3: CURRENT SOFTWARE ═══
bg(c)
slide_number(c, 3)
text(c, 1*inch, H - 1.2*inch, 'CURRENT SOFTWARE', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1.2*inch)
wrap_text(c, 1*inch, H - 1.9*inch,
    'POS systems record transactions. Then they wait.',
    size=30, font='Helvetica-Bold', max_width=10*inch)

bullet(c, 1*inch, H - 3.2*inch, [
    'Manual end-of-day reports',
    'Spreadsheet analysis by the owner or an expensive specialist',
    'No cross-system correlation (sales x weather x inventory x labor)',
], size=14, leading=30)

text(c, 1*inch, 1.8*inch,
    'The dominant POS in Mexico runs .NET 4.5 from 2007.',
    size=14, color=GRAY)
c.showPage()

# ═══ SLIDE 4: THESIS ═══
bg(c)
slide_number(c, 4)
text_center(c, H/2 + 1.2*inch, 'THE THESIS', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, W/2 - 0.4*inch, H/2 + 1.05*inch, 0.8*inch)

wrap_text(c, 1.5*inch, H/2 + 0.4*inch,
    'What if the restaurant\'s operating system watched continuously and surfaced problems before they became losses?',
    size=26, font='Helvetica-Bold', max_width=W - 3*inch, leading=38)

text_center(c, H/2 - 1.2*inch, 'Not a dashboard that waits to be opened.', size=15, color=GRAY)
text_center(c, H/2 - 1.6*inch, 'Not a report that waits to be generated.', size=15, color=GRAY)
text_center(c, H/2 - 2.2*inch, 'A system that observes, detects, and acts.', size=16, color=WHITE, font='Helvetica-Bold')
c.showPage()

# ═══ SLIDE 5: FULLSITE ═══
bg(c)
slide_number(c, 5)
text(c, 1*inch, H - 1.2*inch, 'FULLSITE', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 0.6*inch)
wrap_text(c, 1*inch, H - 1.9*inch,
    'Operational intelligence built on a production-grade restaurant stack.',
    size=26, font='Helvetica-Bold', max_width=10*inch, leading=36)

# Three pillars
pillars = [
    ('CAPTURE', 'POS, KDS, inventory, cash,\nevent stream — every signal'),
    ('OBSERVE', '36 autonomous agents\nagainst 915 days of history'),
    ('ACT', 'What to buy, what to watch,\nwhat to change — delivered'),
]
px = 1*inch
for label, desc in pillars:
    c.setFillColor(DARK_GRAY)
    c.roundRect(px, H - 5.2*inch, 3.2*inch, 1.8*inch, 8, fill=1, stroke=0)
    text(c, px + 0.2*inch, H - 3.7*inch, label, size=12, color=ACCENT, font='Helvetica-Bold')
    lines = desc.split('\n')
    for i, ln in enumerate(lines):
        text(c, px + 0.2*inch, H - 4.1*inch - i*18, ln, size=12, color=LIGHT_GRAY)
    px += 3.6*inch

text(c, 1*inch, 1.4*inch, 'The intelligence layer requires owning the capture layer. That\'s why we built the full stack.',
     size=13, color=GRAY)
c.showPage()

# ═══ SLIDE 6: WHY OWN CAPTURE ═══
bg(c)
slide_number(c, 6)
text(c, 1*inch, H - 1.2*inch, 'WHY OWN THE CAPTURE LAYER', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1.8*inch)
wrap_text(c, 1*inch, H - 1.9*inch,
    'We tried connecting to existing POS systems first.',
    size=28, font='Helvetica-Bold', max_width=10*inch)

bullet(c, 1*inch, H - 3.0*inch, [
    'Wansoft charges $10,000 MXN per integration + $500/month for API access',
    'API quality is poor — no real-time events, no item-level granularity',
    'Every POS vendor is a gatekeeper between us and the operational data',
], size=14, leading=34)

text(c, 1*inch, H - 4.8*inch, 'We needed sub-second event granularity across POS, kitchen, inventory, and payments.',
     size=14, color=WHITE)
text(c, 1*inch, H - 5.2*inch, 'So we built the entire stack.', size=16, color=ACCENT, font='Helvetica-Bold')
c.showPage()

# ═══ SLIDE 7: LIVE IN PRODUCTION ═══
bg(c)
slide_number(c, 7)
text(c, 1*inch, H - 1.2*inch, 'LIVE IN PRODUCTION', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1.2*inch)
text(c, 1*inch, H - 1.9*inch, 'Running at AMALAY Coffee & Market since July 8, 2026.', size=22, font='Helvetica-Bold')

components = [
    ('POS (3 terminals)', 'Production'),
    ('KDS (kitchen display)', 'Production'),
    ('Print bridge (ticket + kitchen)', 'Production'),
    ('Offline-first / recovery', 'Production'),
    ('Fingerprint authentication', 'Production'),
    ('Cash drawer + cortes de caja', 'Production'),
    ('Inventory reconciliation engine', 'Deployed'),
    ('CFDI 4.0 (Facturama)', 'Built'),
    ('Electron kiosk apps', 'Deployed'),
]
y = H - 2.8*inch
widths = [5*inch, 2*inch]
table_row(c, 1*inch, y, ['Component', 'Status'], widths, size=10, color=ACCENT, font='Helvetica-Bold', bg_color=MID_GRAY)
for comp, status in components:
    y -= 22
    sc = ACCENT if status == 'Production' else GRAY
    table_row(c, 1*inch, y, [comp, ''], widths, size=11, color=LIGHT_GRAY)
    c.setFont('Helvetica-Bold', 11)
    c.setFillColor(sc)
    c.drawString(1*inch + widths[0] + 8, y, status)

text(c, 8*inch, H - 1.9*inch, 'Runs on any hardware.', size=14, color=GRAY)
text(c, 8*inch, H - 2.2*inch, 'Zero proprietary dependency.', size=14, color=GRAY)
c.showPage()

# ═══ SLIDE 8: AGENTS ═══
bg(c)
slide_number(c, 8)
text(c, 1*inch, H - 1.2*inch, 'OPERATIONAL INTELLIGENCE', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1.6*inch)
text(c, 1*inch, H - 1.9*inch, '36 analytical agents. Not chatbots — autonomous workflows.', size=22, font='Helvetica-Bold')

agents = [
    ('Purchase Predictor', 'Analyzes 30-day purchase history, explodes recipes into\ningredient demand, projects 7-day need by department.\nOperator reviews and approves.'),
    ('Anomaly Detector', 'Compares real-time sales against historical day-of-week\npatterns. Detects deviations before the owner notices.'),
    ('Climate + Events', 'Fetches 3-day weather forecast, cross-references with\n90 days of sales and 40+ local events. Recommends\nmenu adjustments.'),
]
px = 1*inch
for title, desc in agents:
    c.setFillColor(DARK_GRAY)
    c.roundRect(px, H - 5.6*inch, 3.5*inch, 2.8*inch, 8, fill=1, stroke=0)
    text(c, px + 0.2*inch, H - 3.2*inch, title, size=13, color=ACCENT, font='Helvetica-Bold')
    for i, ln in enumerate(desc.split('\n')):
        text(c, px + 0.2*inch, H - 3.6*inch - i*16, ln, size=10, color=LIGHT_GRAY)
    px += 3.7*inch

text(c, 1*inch, 1.0*inch, 'Also: fraud, waste, menu engineering, staffing, table rotation, speed of service, upselling, suppliers, cost variance, CRM.', size=11, color=GRAY)
c.showPage()

# ═══ SLIDE 9: THE QUESTION ═══
bg(c)
slide_number(c, 9)
text(c, 1*inch, H - 1.2*inch, 'THE QUESTION WE ARE PROVING', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1.8*inch)

wrap_text(c, 1*inch, H - 2.0*inch,
    '"Where is the value that restaurants will pay for — not a fixed fee, but a variable tied to measurable outcomes?"',
    size=18, color=LIGHT_GRAY, font='Helvetica-Oblique', max_width=10*inch, leading=26)

y = H - 3.5*inch
outcomes = [
    ('Waste / merma reduction', 'High', '2-5% of revenue'),
    ('Fraud / theft detection', 'High', '1-3% of revenue'),
    ('Purchasing optimization', 'Medium', '1-2% of COGS'),
    ('Labor / staffing', 'Medium', '3-8% of labor cost'),
    ('Menu engineering', 'High', '1-3% of revenue'),
]
widths3 = [4*inch, 2*inch, 3*inch]
table_row(c, 1*inch, y, ['Operational Outcome', 'Measurability', 'Estimated Impact'], widths3, size=10, color=ACCENT, font='Helvetica-Bold', bg_color=MID_GRAY)
for out, meas, impact in outcomes:
    y -= 24
    table_row(c, 1*inch, y, [out, meas, impact], widths3, size=11, color=LIGHT_GRAY)

text(c, 1*inch, 1.6*inch, 'The honest answer: we don\'t know yet which one becomes the wedge.', size=14, color=WHITE, font='Helvetica-Bold')
text(c, 1*inch, 1.2*inch, 'That\'s exactly what the pre-seed funds will prove.', size=14, color=ACCENT)
c.showPage()

# ═══ SLIDE 10: AMALAY ═══
bg(c)
slide_number(c, 10)
text(c, 1*inch, H - 1.2*inch, 'AMALAY: OPERATIONAL VALIDATION', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 2*inch)
text(c, 1*inch, H - 1.9*inch, 'AMALAY Coffee & Market — Monterrey, MX', size=22, font='Helvetica-Bold')

metrics = [
    ('$31.1M MXN', '2025 Revenue'),
    ('+12%', 'YoY Growth'),
    ('$82K', 'Daily Average'),
    ('915', 'Days of Data'),
    ('522', 'Active Items'),
    ('178', 'Recipes'),
    ('1,050', 'Ingredients'),
    ('40', 'Staff'),
]
px = 1*inch
py = H - 3.0*inch
for i, (val, label) in enumerate(metrics):
    c.setFillColor(DARK_GRAY)
    c.roundRect(px, py, 2.6*inch, 1.2*inch, 6, fill=1, stroke=0)
    text(c, px + 0.2*inch, py + 0.7*inch, val, size=22, color=ACCENT, font='Helvetica-Bold')
    text(c, px + 0.2*inch, py + 0.2*inch, label, size=11, color=GRAY)
    px += 2.8*inch
    if (i + 1) % 4 == 0:
        px = 1*inch
        py -= 1.5*inch

text(c, 1*inch, 1.2*inch, 'AMALAY is the founder\'s family restaurant.', size=13, color=WHITE, font='Helvetica-Bold')
text(c, 1*inch, 0.85*inch, 'This is operational validation — not independent commercial validation.', size=13, color=GRAY)
c.showPage()

# ═══ SLIDE 11: DE-RISKED / OPEN ═══
bg(c)
slide_number(c, 11)
text(c, 1*inch, H - 1.2*inch, 'WHAT\'S DE-RISKED / WHAT\'S OPEN', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 2*inch)

# Two columns
col1_x = 1*inch
col2_x = 7*inch
col_w = 5*inch

c.setFillColor(HexColor('#0d2818'))
c.roundRect(col1_x, H - 5.8*inch, col_w, 4*inch, 8, fill=1, stroke=0)
text(c, col1_x + 0.3*inch, H - 2.1*inch, 'DE-RISKED', size=14, color=ACCENT, font='Helvetica-Bold')
derisked = ['Full POS + KDS + printing + offline', '36 analytical agents built', '915 days of operational data', 'Inventory reconciliation engine', 'Server-side mutation authority', 'Hardware-agnostic architecture']
for i, item in enumerate(derisked):
    text(c, col1_x + 0.3*inch, H - 2.6*inch - i*24, item, size=12, color=LIGHT_GRAY)

c.setFillColor(HexColor('#1a1a2e'))
c.roundRect(col2_x, H - 5.8*inch, col_w, 4*inch, 8, fill=1, stroke=0)
text(c, col2_x + 0.3*inch, H - 2.1*inch, 'OPEN', size=14, color=HexColor('#f59e0b'), font='Helvetica-Bold')
open_items = ['External willingness to pay', 'Which outcome becomes the wedge', 'Deployment without founder', 'Repeatable installation', 'Second restaurant validation', 'Team beyond solo founder']
for i, item in enumerate(open_items):
    text(c, col2_x + 0.3*inch, H - 2.6*inch - i*24, item, size=12, color=LIGHT_GRAY)

text(c, 1*inch, 1.0*inch, 'Product risk: substantially retired.  Commercial risk: entirely open.', size=15, color=WHITE, font='Helvetica-Bold')
c.showPage()

# ═══ SLIDE 12: BEACHHEAD ═══
bg(c)
slide_number(c, 12)
text(c, 1*inch, H - 1.2*inch, 'BEACHHEAD', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 0.8*inch)
text(c, 1*inch, H - 1.9*inch, 'Premium casual / brunch + cafe — Monterrey metro', size=22, font='Helvetica-Bold')

bullet(c, 1*inch, H - 2.8*inch, [
    '$300K - $1.5M MXN monthly revenue',
    '10-40 employees',
    'Owner-operator or small group',
    'Currently using legacy POS (Wansoft, SoftRestaurant)',
    'Estimated addressable: 600-900 restaurants in Monterrey',
], size=13, leading=28)

text(c, 7.5*inch, H - 2.0*inch, 'PIPELINE', size=13, color=ACCENT, font='Helvetica-Bold')
pipeline = [
    ('Production', 'AMALAY (founder\'s restaurant)'),
    ('LOI (non-binding)', 'Grupo Galeria: Dunkin, Carl\'s Jr, BWW, IHOP'),
    ('Active conversations', '3 independent restaurants'),
]
y = H - 2.5*inch
for stage, detail in pipeline:
    c.setFillColor(DARK_GRAY)
    c.roundRect(7.5*inch, y - 0.15*inch, 4.8*inch, 0.55*inch, 4, fill=1, stroke=0)
    text(c, 7.7*inch, y, stage, size=10, color=ACCENT, font='Helvetica-Bold')
    text(c, 9.5*inch, y, detail, size=10, color=LIGHT_GRAY)
    y -= 0.7*inch
c.showPage()

# ═══ SLIDE 13: BUSINESS MODEL ═══
bg(c)
slide_number(c, 13)
text(c, 1*inch, H - 1.2*inch, 'BUSINESS MODEL', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1*inch)

text(c, 1*inch, H - 2.0*inch, 'Today', size=18, color=WHITE, font='Helvetica-Bold')
text(c, 1*inch, H - 2.5*inch, '$1,999 MXN / month per location', size=28, color=ACCENT, font='Helvetica-Bold')
bullet(c, 1*inch, H - 3.1*inch, [
    '+$499/month per additional terminal',
    '$0 installation (BYOD hardware)',
    'No long-term contract',
    '78% cheaper than Wansoft in year 1',
], size=12, leading=24)

text(c, 7*inch, H - 2.0*inch, 'Tomorrow: the variable', size=18, color=WHITE, font='Helvetica-Bold')
wrap_text(c, 7*inch, H - 2.6*inch,
    'Toast generates $6.15B in revenue. 81% comes from payments and lending — not software. The SaaS fee is the wedge. The real business model is transactional.',
    size=12, color=LIGHT_GRAY, max_width=5*inch, leading=18)

bullet(c, 7*inch, H - 3.9*inch, [
    'Embedded payments',
    'Performance-based pricing',
    'Supplier marketplace / GPO',
    'Lending / payroll',
], size=12, leading=24)
c.showPage()

# ═══ SLIDE 14: COMPETITION ═══
bg(c)
slide_number(c, 14)
text(c, 1*inch, H - 1.2*inch, 'COMPETITION', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 0.8*inch)
text(c, 1*inch, H - 1.9*inch, 'Fragmented market. Weak incumbents. No real AI.', size=22, font='Helvetica-Bold')

y = H - 2.8*inch
widths4 = [2.5*inch, 2*inch, 2.5*inch, 1*inch, 3.3*inch]
table_row(c, 1*inch, y, ['Competitor', 'Restaurants', 'Price', 'AI', 'Weakness'], widths4, size=10, color=ACCENT, font='Helvetica-Bold', bg_color=MID_GRAY)
comps = [
    ('SoftRestaurant', '42,000+', '$500-$1,500/mo', 'No', 'Legacy, no intelligence'),
    ('Wansoft (Clip)', '~2,000', '$2,499 + SaaS', 'No', '.NET 4.5 from 2007'),
    ('Parrot', '1,500+', '$1,800-$2,800/mo', 'No', 'No AI'),
    ('Clip POS', 'Large', 'Free + 3.6% tx', 'No', 'Payment-first, basic'),
    ('Calisto AI', '~100', 'Unknown', 'Yes', 'AI only, no full POS'),
    ('Fudo', 'Growing', 'From $360/mo', 'Partial', 'WhatsApp AI only'),
]
for comp_data in comps:
    y -= 24
    table_row(c, 1*inch, y, comp_data, widths4, size=11, color=LIGHT_GRAY)

text(c, 1*inch, 1.2*inch, 'Fullsite: the only system that owns the complete capture-to-intelligence pipeline.', size=14, color=ACCENT, font='Helvetica-Bold')
c.showPage()

# ═══ SLIDE 15: FOUNDER ═══
bg(c)
slide_number(c, 15)
text(c, 1*inch, H - 1.2*inch, 'TEAM', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 0.4*inch)

text(c, 1*inch, H - 2.0*inch, 'Daniel Ramonfaur', size=28, font='Helvetica-Bold')
text(c, 1*inch, H - 2.4*inch, 'Founder & CEO', size=14, color=ACCENT)

bullet(c, 1*inch, H - 3.0*inch, [
    'Built the entire stack solo: POS, KDS, inventory engine, 36 AI agents, data pipeline',
    'Deep restaurant operations domain from AMALAY',
    'Zero to production in 3 months',
], size=13, leading=30)

text(c, 7*inch, H - 2.0*inch, 'Domain Advisor', size=14, color=GRAY)
text(c, 7*inch, H - 2.4*inch, 'Eduardo de la Garza', size=18, font='Helvetica-Bold')
text(c, 7*inch, H - 2.7*inch, '13 years leading Wansoft commercial operation', size=12, color=GRAY)

text(c, 7*inch, H - 3.5*inch, 'Hiring with this round:', size=14, color=ACCENT, font='Helvetica-Bold')
text(c, 7*inch, H - 3.9*inch, 'CTO / Technical Co-founder', size=14, color=WHITE, font='Helvetica-Bold')
text(c, 7*inch, H - 4.2*inch, 'Eliminate founder dependency, own architecture', size=12, color=GRAY)
text(c, 7*inch, H - 4.7*inch, 'CCO / Head of Sales', size=14, color=WHITE, font='Helvetica-Bold')
text(c, 7*inch, H - 5.0*inch, 'Prove repeatable sales process, build pipeline', size=12, color=GRAY)

text(c, 1*inch, 1.2*inch, 'Cap table: Daniel Ramonfaur — 100%', size=14, color=WHITE, font='Helvetica-Bold')
c.showPage()

# ═══ SLIDE 16: THE ASK ═══
bg(c)
slide_number(c, 16)
text_center(c, H - 1.2*inch, 'THE ASK', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, W/2 - 0.3*inch, H - 1.35*inch, 0.6*inch)

text_center(c, H - 2.2*inch, '$500K USD Pre-Seed', size=36, font='Helvetica-Bold')
text_center(c, H - 2.7*inch, 'Post-money SAFE  —  $5M USD cap  —  YC standard terms', size=14, color=GRAY)

# Use of funds
funds = [
    ('Team', '$250K', 'CTO + Sales hire'),
    ('Product', '$100K', 'Deployment automation'),
    ('Go-to-market', '$100K', '10-15 restaurants'),
    ('Ops / Legal', '$50K', 'Incorporation, IP'),
]
px = 1.5*inch
for label, amount, purpose in funds:
    c.setFillColor(DARK_GRAY)
    c.roundRect(px, H - 4.8*inch, 2.5*inch, 1.4*inch, 6, fill=1, stroke=0)
    text(c, px + 0.2*inch, H - 3.8*inch, amount, size=22, color=ACCENT, font='Helvetica-Bold')
    text(c, px + 0.2*inch, H - 4.15*inch, label, size=12, color=WHITE, font='Helvetica-Bold')
    text(c, px + 0.2*inch, H - 4.45*inch, purpose, size=10, color=GRAY)
    px += 2.7*inch

text_center(c, 1.6*inch, 'Two risks eliminated:', size=14, color=WHITE, font='Helvetica-Bold')
text_center(c, 1.2*inch, '1. Commercial validation — prove external willingness to pay', size=13, color=LIGHT_GRAY)
text_center(c, 0.85*inch, '2. Founder dependency — build a 3-person core', size=13, color=LIGHT_GRAY)
c.showPage()

# ═══ SLIDE 17: MILESTONES ═══
bg(c)
slide_number(c, 17)
text(c, 1*inch, H - 1.2*inch, '18-MONTH MILESTONES', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1.3*inch)

milestones = [
    ('Month 3', 'CTO hired. 3 restaurants deployed.'),
    ('Month 6', '5 paying restaurants. $10K MXN MRR.'),
    ('Month 9', '10 restaurants. Deployment <30 min without founder.'),
    ('Month 12', '15 restaurants. $30K MXN MRR. Variable wedge identified.'),
    ('Month 18', 'Seed-ready. Repeatable unit economics. YC W27 submitted.'),
]
y = H - 2.2*inch
for month, desc in milestones:
    c.setFillColor(DARK_GRAY)
    c.roundRect(1*inch, y - 0.15*inch, 10.5*inch, 0.6*inch, 4, fill=1, stroke=0)
    c.setFillColor(ACCENT)
    c.roundRect(1*inch, y - 0.15*inch, 1.5*inch, 0.6*inch, 4, fill=1, stroke=0)
    text(c, 1.15*inch, y, month, size=12, color=BG, font='Helvetica-Bold')
    text(c, 2.7*inch, y, desc, size=13, color=LIGHT_GRAY)
    y -= 0.85*inch

text(c, 1*inch, 1.2*inch, 'These are targets, not commitments.', size=13, color=GRAY)
c.showPage()

# ═══ SLIDE 18: CLOSING ═══
bg(c)
accent_line(c, W/2 - 2*inch, H/2 + 1.5*inch, 4*inch, 3)

text_center(c, H/2 + 0.8*inch, 'The product is built.', size=28, font='Helvetica-Bold')
text_center(c, H/2 + 0.1*inch, 'The question is whether restaurants will pay', size=22, color=LIGHT_GRAY)
text_center(c, H/2 - 0.3*inch, 'for operational intelligence.', size=22, color=LIGHT_GRAY)

text_center(c, H/2 - 1.2*inch, 'That\'s what we\'re proving next.', size=22, color=ACCENT, font='Helvetica-Bold')

text_center(c, 1.6*inch, 'fullsite.mx', size=14, color=GRAY)
text_center(c, 1.2*inch, 'daniel@fullsite.mx', size=14, color=GRAY)
c.showPage()

# ═══ APPENDIX A ═══
bg(c, BG2)
text(c, 1*inch, H - 1.2*inch, 'APPENDIX A — TECHNOLOGY DEPTH', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 2*inch)

tech = [
    ('Stack', 'Next.js 15, Supabase (PostgreSQL), Vercel, Claude API'),
    ('POS', 'PWA + Electron kiosk, runs on any hardware'),
    ('Offline', 'IndexedDB queue, revision-aware optimistic concurrency'),
    ('Inventory', 'Canonical recipe versioning, R1 reconciliation engine, prevalidation-before-mutation,\ndeterministic target locking, conservation-before-convenience, pinned treatment immutability'),
    ('Security', 'Server-side 3-state sale authority gate, SECURITY DEFINER RPCs,\nanon/authenticated cannot mutate inventory directly'),
    ('Pipeline', '915 days Wansoft data via Playwright scraping + API extraction + JSONB parsing'),
    ('Events', 'Shadow-mode append-only event stream live since June 2026'),
]
y = H - 2.0*inch
for label, desc in tech:
    text(c, 1*inch, y, label, size=12, color=ACCENT, font='Helvetica-Bold')
    lines = desc.split('\n')
    for i, ln in enumerate(lines):
        text(c, 2.5*inch, y - i*16, ln, size=11, color=LIGHT_GRAY)
    y -= (len(lines)) * 16 + 14
c.showPage()

# ═══ APPENDIX B ═══
bg(c, BG2)
text(c, 1*inch, H - 1.2*inch, 'APPENDIX B — AGENT INVENTORY', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1.8*inch)
text(c, 1*inch, H - 1.8*inch, '36 autonomous analytical agents  |  4,800+ cumulative production executions', size=14, color=WHITE, font='Helvetica-Bold')

agents_list = [
    'Anomaly Detector', 'Anti-Fraud', 'Auto-86', 'Climate + Events', 'Close Predictor',
    'Config Validator', 'Cost Variance', 'CRM Recompra', 'Daily Briefing', 'Hermes (Router)',
    'Intraday Sales', 'Inventory Auto-Order', 'Kitchen Quality', 'Menu Engineering',
    'Menu Gap Analysis', 'Orchestrator', 'POS Aggregator', 'POS Snapshot',
    'Proactive Alerts', 'Purchase Predictor', 'Reservas', 'Smoke Test',
    'Speed of Service', 'Staffing Optimizer', 'Stock Alert', 'Supplier Monitor',
    'Table Time', 'Ticket Detail', 'Tips Analyzer', 'Upselling',
    'Uptime Monitor', 'Waste Detector', 'Weekly Report', 'Weekly Summary',
    'Wansoft Query', 'Wansoft Staleness',
]
y = H - 2.4*inch
cols = 4
col_w = (W - 2*inch) / cols
for i, agent in enumerate(agents_list):
    col = i % cols
    row = i // cols
    text(c, 1*inch + col * col_w, y - row * 20, agent, size=10, color=LIGHT_GRAY)
c.showPage()

# ═══ APPENDIX C ═══
bg(c, BG2)
text(c, 1*inch, H - 1.2*inch, 'APPENDIX C — GRUPO GALERIA LOI', size=11, color=ACCENT, font='Helvetica-Bold')
accent_line(c, 1*inch, H - 1.35*inch, 1.8*inch)

text(c, 1*inch, H - 2.0*inch, 'Non-binding Letter of Intent', size=22, font='Helvetica-Bold')

loi_items = [
    'Grupo Galeria operates: Dunkin Mexico, Carl\'s Jr, BWW, IHOP',
    'Intent to evaluate Fullsite through pilots in selected locations',
    'Timeline: define pilot parameters within 6 months',
    'Board member: Monica Garcia Pons',
    'Status: under discussion',
]
bullet(c, 1*inch, H - 2.8*inch, loi_items, size=14, leading=32)

text(c, 1*inch, 1.2*inch, 'Non-binding. Neither party is obligated to proceed unless a definitive agreement is signed.', size=12, color=GRAY)
c.showPage()

# Save
c.save()
print(f'Deck saved to {OUTPUT}')
print(f'Total slides: 21 (18 main + 3 appendix)')

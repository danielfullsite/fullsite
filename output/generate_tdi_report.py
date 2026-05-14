#!/usr/bin/env python3
"""
TDI Report Generator - Amalay Coffee & Market - April 2026
Generates a 14-page professional PDF report in Power BI style.
"""

import json
import requests
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.backends.backend_pdf import PdfPages
from matplotlib.patches import FancyBboxPatch
import matplotlib.ticker as mticker
from datetime import datetime, timedelta
from collections import defaultdict
import calendar

# ── Colors & Style ──────────────────────────────────────────────
PRIMARY = '#3b82f6'
PRIMARY_DARK = '#2563eb'
PRIMARY_LIGHT = '#93c5fd'
SECONDARY = '#6b7280'
GRAY_LIGHT = '#f3f4f6'
GRAY_MED = '#d1d5db'
GRAY_TEXT = '#374151'
GRAY_DARK = '#1f2937'
WHITE = '#ffffff'
GREEN = '#10b981'
RED = '#ef4444'
ORANGE = '#f59e0b'
FOOD_COLOR = '#3b82f6'
BEV_COLOR = '#f59e0b'
MARKET_COLOR = '#10b981'

PAGE_W, PAGE_H = 11, 8.5

# ── Load Data ───────────────────────────────────────────────────
with open('/tmp/april_2026_data.json') as f:
    data = json.load(f)

days = data['days']
prev_year = data['prev_year']
meseros = data['meseros']
grupos = data['grupos']
saucers_top20 = data['saucers_top20']
order_types = data['order_types']
payments = data['payments']

# ── Fetch monthly revenue from Supabase ─────────────────────────
sb_url = 'https://qjiomlvudfmzuvqvhwpk.supabase.co'
sb_key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFqaW9tbHZ1ZGZtenV2cXZod3BrIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc3NTc4NDkxNSwiZXhwIjoyMDkxMzYwOTE1fQ.mrQAlN3TFf6haWsCGUoSCvNOPBFzvNqz3vaw91RAd_Y'
headers = {'apikey': sb_key, 'Authorization': f'Bearer {sb_key}'}

print("Fetching Supabase data...")
r = requests.get(f'{sb_url}/rest/v1/wansoft_daily',
    headers=headers,
    params={'select': 'fecha,ventas_dia', 'order': 'fecha.asc', 'limit': '10000'})
sb_data = r.json()
print(f"  Got {len(sb_data)} daily records")

# Aggregate to monthly
monthly_rev = defaultdict(float)
monthly_tickets = defaultdict(int)
for rec in sb_data:
    dt = datetime.strptime(rec['fecha'][:10], '%Y-%m-%d')
    key = dt.strftime('%Y-%m')
    monthly_rev[key] += float(rec.get('ventas_dia', 0) or 0)

# Also get tickets from supabase
r2 = requests.get(f'{sb_url}/rest/v1/wansoft_daily',
    headers=headers,
    params={'select': 'fecha,tickets_count,personas_restaurant,ticket_promedio_restaurant', 'order': 'fecha.asc', 'limit': '10000'})
sb_data2 = r2.json()
monthly_customers = defaultdict(int)
monthly_avgcheck = defaultdict(list)
for rec in sb_data2:
    dt = datetime.strptime(rec['fecha'][:10], '%Y-%m-%d')
    key = dt.strftime('%Y-%m')
    monthly_tickets[key] += int(rec.get('tickets_count', 0) or 0)
    monthly_customers[key] += int(rec.get('personas_restaurant', 0) or 0)
    tp = rec.get('ticket_promedio_restaurant', 0)
    if tp:
        monthly_avgcheck[key].append(float(tp))

# Sort months
all_months = sorted(monthly_rev.keys())
# Filter from Jan 2024 to Apr 2026
all_months = [m for m in all_months if '2024-01' <= m <= '2026-04']

# ── Derived metrics ──────────────────────────────────────────────
total_revenue = sum(d['ventas_dia'] for d in days)
total_tickets = sum(d['tickets_count'] for d in days)
total_customers = sum(d.get('personas_restaurant', 0) for d in days)
avg_check = total_revenue / total_tickets if total_tickets else 0

py_revenue = sum(d['ventas_dia'] for d in prev_year)
py_tickets = sum(d['tickets_count'] for d in prev_year)
py_customers = sum(d.get('personas_restaurant', 0) for d in prev_year)
py_avg_check = py_revenue / py_tickets if py_tickets else 0

rev_vs_py = (total_revenue - py_revenue) / py_revenue * 100 if py_revenue else 0
cust_vs_py = (total_customers - py_customers) / py_customers * 100 if py_customers else 0
avgcheck_vs_py = (avg_check - py_avg_check) / py_avg_check * 100 if py_avg_check else 0

# Classify groups into Food / Beverage / Market
BEVERAGE_GROUPS = {'COFFEE HOT/ICE', 'FRAPPES', 'SMOOTHIES', 'JUGOS', 'FRESH DRINKS',
                   'TEA & TISANAS', 'SODAS', 'BEBIDAS OH', 'VINOS', 'CERVEZA'}
MARKET_GROUPS = {'MARKET - HEALTHY SNACKS & ABARROTES', 'MARKET - MARCA PROPIA AMALAY',
                 'MARKET - VITAMINAS & SUPLEMENTOS', 'MARKET - REGALOS & DETALLES',
                 'VENTAS TERCEROS', 'Nutricion avanzada', 'HABITS BY NFK'}

food_rev = sum(g['total'] for g in grupos if g['name'] not in BEVERAGE_GROUPS and g['name'] not in MARKET_GROUPS)
bev_rev = sum(g['total'] for g in grupos if g['name'] in BEVERAGE_GROUPS)
market_rev = sum(g['total'] for g in grupos if g['name'] in MARKET_GROUPS)


# ── Helper functions ──────────────────────────────────────────────
def fmt_money(v, decimals=0):
    if decimals == 0:
        return f"${v:,.0f}"
    return f"${v:,.{decimals}f}"

def fmt_pct(v):
    sign = '+' if v > 0 else ''
    return f"{sign}{v:.1f}%"

def add_footer(fig, page_num, total_pages=14):
    fig.text(0.05, 0.02, 'fullsite.', fontsize=9, color=PRIMARY, fontweight='bold',
             fontstyle='italic')
    fig.text(0.5, 0.02, f'AMALAY Coffee & Market  |  TDI Report  |  April 2026',
             fontsize=7, color=SECONDARY, ha='center')
    fig.text(0.95, 0.02, f'{page_num}/{total_pages}', fontsize=7, color=SECONDARY, ha='right')

def new_page():
    fig = plt.figure(figsize=(PAGE_W, PAGE_H))
    fig.patch.set_facecolor(WHITE)
    return fig

def add_title_bar(fig, title, y=0.93):
    fig.patches.append(FancyBboxPatch((0.03, y - 0.01), 0.94, 0.055,
                                       boxstyle="round,pad=0.005",
                                       facecolor=PRIMARY, edgecolor='none',
                                       transform=fig.transFigure, zorder=5))
    fig.text(0.5, y + 0.015, title, fontsize=14, color=WHITE,
             fontweight='bold', ha='center', va='center', zorder=10)


# ══════════════════════════════════════════════════════════════════
#  BUILD PDF
# ══════════════════════════════════════════════════════════════════
output_path = '/Users/danielrg/fullsite/output/TDI_Report_Amalay_April_2026.pdf'
print(f"Generating PDF: {output_path}")

with PdfPages(output_path) as pdf:

    # ─────────────────────────────────────────────────────────────
    #  PAGE 1: COVER
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    fig.patches.append(FancyBboxPatch((0, 0), 1, 1,
                                       boxstyle="square,pad=0",
                                       facecolor=PRIMARY_DARK, edgecolor='none',
                                       transform=fig.transFigure))
    # Decorative bars
    fig.patches.append(FancyBboxPatch((0, 0.42), 1, 0.005,
                                       boxstyle="square,pad=0",
                                       facecolor=WHITE, edgecolor='none',
                                       transform=fig.transFigure, alpha=0.3))
    fig.patches.append(FancyBboxPatch((0, 0.56), 1, 0.005,
                                       boxstyle="square,pad=0",
                                       facecolor=WHITE, edgecolor='none',
                                       transform=fig.transFigure, alpha=0.3))

    fig.text(0.5, 0.65, 'TDI Report', fontsize=42, color=WHITE,
             fontweight='bold', ha='center', va='center')
    fig.text(0.5, 0.50, 'Amalay Coffee & Market', fontsize=28, color=WHITE,
             ha='center', va='center', alpha=0.9)
    fig.text(0.5, 0.38, 'April 2026', fontsize=22, color=PRIMARY_LIGHT,
             ha='center', va='center')
    fig.text(0.5, 0.20, 'Monthly Performance Analysis', fontsize=14, color=WHITE,
             ha='center', va='center', alpha=0.6)
    fig.text(0.05, 0.04, 'fullsite.', fontsize=11, color=WHITE, fontweight='bold',
             fontstyle='italic', alpha=0.7)
    fig.text(0.95, 0.04, 'Confidential', fontsize=9, color=WHITE, ha='right', alpha=0.5)
    pdf.savefig(fig)
    plt.close()
    print("  Page 1: Cover")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 2: DASHBOARD OVERVIEW
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Dashboard Overview')

    # KPI cards
    kpi_data = [
        ('Revenue', fmt_money(total_revenue), f'vs PY: {fmt_pct(rev_vs_py)}', rev_vs_py),
        ('Customers', f'{total_customers:,}', f'vs PY: {fmt_pct(cust_vs_py)}', cust_vs_py),
        ('Avg Check', fmt_money(avg_check), f'vs PY: {fmt_pct(avgcheck_vs_py)}', avgcheck_vs_py),
        ('Tickets', f'{total_tickets:,}', f'{total_tickets/30:.0f} per day avg', 0),
    ]
    for i, (label, value, sub, delta) in enumerate(kpi_data):
        x = 0.05 + i * 0.235
        fig.patches.append(FancyBboxPatch((x, 0.78), 0.21, 0.12,
                                           boxstyle="round,pad=0.008",
                                           facecolor=GRAY_LIGHT, edgecolor=GRAY_MED,
                                           transform=fig.transFigure, linewidth=0.5))
        fig.text(x + 0.105, 0.875, label, fontsize=9, color=SECONDARY,
                 ha='center', va='center', fontweight='bold')
        fig.text(x + 0.105, 0.835, value, fontsize=16, color=GRAY_DARK,
                 ha='center', va='center', fontweight='bold')
        color = GREEN if delta >= 0 else RED
        if i == 3:
            color = SECONDARY
        fig.text(x + 0.105, 0.80, sub, fontsize=8, color=color,
                 ha='center', va='center')

    # Monthly revenue chart
    ax1 = fig.add_axes([0.06, 0.28, 0.55, 0.42])
    m_labels = [datetime.strptime(m, '%Y-%m').strftime('%b\n%y') for m in all_months]
    m_vals = [monthly_rev[m] / 1000 for m in all_months]
    bars = ax1.bar(range(len(m_labels)), m_vals, color=[PRIMARY if m != '2026-04' else PRIMARY_DARK for m in all_months],
                   width=0.7, edgecolor='none')
    ax1.set_xticks(range(len(m_labels)))
    ax1.set_xticklabels(m_labels, fontsize=5.5, color=SECONDARY)
    ax1.set_ylabel('Revenue (K)', fontsize=8, color=SECONDARY)
    ax1.set_title('Monthly Revenue (Jan 2024 - Apr 2026)', fontsize=10, color=GRAY_DARK,
                  fontweight='bold', pad=8)
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(axis='y', labelsize=7, colors=SECONDARY)
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: f'${x:,.0f}K'))
    ax1.set_facecolor(WHITE)
    ax1.grid(axis='y', alpha=0.3, color=GRAY_MED)

    # Pie chart - Revenue Distribution
    ax2 = fig.add_axes([0.68, 0.28, 0.28, 0.42])
    pie_vals = [food_rev, bev_rev, market_rev]
    pie_labels = [f'Food\n{fmt_money(food_rev)}', f'Beverages\n{fmt_money(bev_rev)}', f'Market\n{fmt_money(market_rev)}']
    pie_colors = [FOOD_COLOR, BEV_COLOR, MARKET_COLOR]
    wedges, texts = ax2.pie(pie_vals, labels=pie_labels, colors=pie_colors,
                             startangle=90, textprops={'fontsize': 7, 'color': GRAY_DARK})
    ax2.set_title('Revenue Distribution', fontsize=10, color=GRAY_DARK, fontweight='bold', pad=8)

    # Summary bar at bottom
    fig.patches.append(FancyBboxPatch((0.05, 0.06), 0.90, 0.14,
                                       boxstyle="round,pad=0.008",
                                       facecolor=GRAY_LIGHT, edgecolor=GRAY_MED,
                                       transform=fig.transFigure, linewidth=0.5))
    summary_items = [
        (f'Food: {food_rev/total_revenue*100:.1f}%', FOOD_COLOR),
        (f'Beverages: {bev_rev/total_revenue*100:.1f}%', BEV_COLOR),
        (f'Market: {market_rev/total_revenue*100:.1f}%', MARKET_COLOR),
        (f'Gross Sales: {fmt_money(sum(d["ventas_brutas"] for d in days))}', GRAY_DARK),
        (f'Discounts: {fmt_money(sum(d["descuentos"] for d in days))}', RED),
    ]
    for i, (text, color) in enumerate(summary_items):
        fig.text(0.1 + i * 0.175, 0.13, text, fontsize=8, color=color,
                 ha='center', va='center', fontweight='bold')

    add_footer(fig, 2)
    pdf.savefig(fig)
    plt.close()
    print("  Page 2: Dashboard Overview")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 3: REVENUE, CUSTOMERS & AVG CHECK TRENDS
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Revenue, Customers & Average Check - Monthly Trends')

    # Last 15 months
    months_15 = all_months[-15:] if len(all_months) >= 15 else all_months

    # Revenue line chart
    ax1 = fig.add_axes([0.07, 0.55, 0.88, 0.30])
    rev_vals = [monthly_rev[m] / 1000 for m in months_15]
    ax1.plot(range(len(months_15)), rev_vals, color=PRIMARY, linewidth=2, marker='o', markersize=4)
    ax1.fill_between(range(len(months_15)), rev_vals, alpha=0.1, color=PRIMARY)
    ax1.set_xticks(range(len(months_15)))
    ax1.set_xticklabels([datetime.strptime(m, '%Y-%m').strftime('%b %y') for m in months_15],
                         fontsize=6, rotation=45, color=SECONDARY)
    ax1.set_ylabel('Revenue ($K)', fontsize=8, color=SECONDARY)
    ax1.set_title('Monthly Revenue', fontsize=10, color=GRAY_DARK, fontweight='bold')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(axis='y', labelsize=7, colors=SECONDARY)
    ax1.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)

    # Customers bar + Avg Check line
    ax2 = fig.add_axes([0.07, 0.10, 0.42, 0.32])
    cust_vals = [monthly_customers.get(m, 0) for m in months_15]
    ax2.bar(range(len(months_15)), cust_vals, color=PRIMARY_LIGHT, edgecolor='none', width=0.6)
    ax2.set_xticks(range(len(months_15)))
    ax2.set_xticklabels([datetime.strptime(m, '%Y-%m').strftime('%b\n%y') for m in months_15],
                         fontsize=5, color=SECONDARY)
    ax2.set_title('Customers per Month', fontsize=9, color=GRAY_DARK, fontweight='bold')
    ax2.spines['top'].set_visible(False)
    ax2.spines['right'].set_visible(False)
    ax2.spines['left'].set_color(GRAY_MED)
    ax2.spines['bottom'].set_color(GRAY_MED)
    ax2.tick_params(labelsize=6, colors=SECONDARY)
    ax2.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax2.set_facecolor(WHITE)

    ax3 = fig.add_axes([0.55, 0.10, 0.42, 0.32])
    avgc_vals = [np.mean(monthly_avgcheck.get(m, [0])) for m in months_15]
    ax3.plot(range(len(months_15)), avgc_vals, color=ORANGE, linewidth=2, marker='s', markersize=3)
    ax3.fill_between(range(len(months_15)), avgc_vals, alpha=0.1, color=ORANGE)
    ax3.set_xticks(range(len(months_15)))
    ax3.set_xticklabels([datetime.strptime(m, '%Y-%m').strftime('%b\n%y') for m in months_15],
                         fontsize=5, color=SECONDARY)
    ax3.set_title('Average Check Trend', fontsize=9, color=GRAY_DARK, fontweight='bold')
    ax3.spines['top'].set_visible(False)
    ax3.spines['right'].set_visible(False)
    ax3.spines['left'].set_color(GRAY_MED)
    ax3.spines['bottom'].set_color(GRAY_MED)
    ax3.tick_params(labelsize=6, colors=SECONDARY)
    ax3.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: f'${x:,.0f}'))
    ax3.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax3.set_facecolor(WHITE)

    # YTD comparison text
    ytd_months_2026 = [m for m in all_months if m.startswith('2026')]
    ytd_months_2025 = [m.replace('2026', '2025') for m in ytd_months_2026]
    ytd_rev_26 = sum(monthly_rev.get(m, 0) for m in ytd_months_2026)
    ytd_rev_25 = sum(monthly_rev.get(m, 0) for m in ytd_months_2025)

    add_footer(fig, 3)
    pdf.savefig(fig)
    plt.close()
    print("  Page 3: Revenue, Customers & Avg Check Trends")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 4: BY DAY OF WEEK
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Performance by Day of Week')

    # Group current month by day of week
    dow_names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    dow_rev = defaultdict(float)
    dow_tickets = defaultdict(int)
    dow_customers = defaultdict(int)
    dow_count = defaultdict(int)
    dow_avgcheck = defaultdict(list)

    for d in days:
        dt = datetime.strptime(d['fecha'], '%Y-%m-%d')
        dow = dt.weekday()
        dow_rev[dow] += d['ventas_dia']
        dow_tickets[dow] += d['tickets_count']
        dow_customers[dow] += d.get('personas_restaurant', 0)
        dow_count[dow] += 1
        if d.get('ticket_promedio_restaurant'):
            dow_avgcheck[dow].append(d['ticket_promedio_restaurant'])

    # PY by day of week
    py_dow_rev = defaultdict(float)
    py_dow_tickets = defaultdict(int)
    py_dow_customers = defaultdict(int)
    py_dow_count = defaultdict(int)
    py_dow_avgcheck = defaultdict(list)
    for d in prev_year:
        dt = datetime.strptime(d['fecha'], '%Y-%m-%d')
        dow = dt.weekday()
        py_dow_rev[dow] += d['ventas_dia']
        py_dow_tickets[dow] += d['tickets_count']
        py_dow_customers[dow] += d.get('personas_restaurant', 0)
        py_dow_count[dow] += 1
        if d.get('ticket_promedio_restaurant'):
            py_dow_avgcheck[dow].append(d['ticket_promedio_restaurant'])

    # Revenue by DOW
    ax1 = fig.add_axes([0.07, 0.52, 0.42, 0.32])
    x = range(7)
    curr_rev_dow = [dow_rev.get(i, 0) / max(dow_count.get(i, 1), 1) / 1000 for i in range(7)]
    py_rev_dow_vals = [py_dow_rev.get(i, 0) / max(py_dow_count.get(i, 1), 1) / 1000 for i in range(7)]
    w = 0.35
    ax1.bar([i - w/2 for i in x], curr_rev_dow, w, color=PRIMARY, label='Apr 2026', edgecolor='none')
    ax1.bar([i + w/2 for i in x], py_rev_dow_vals, w, color=GRAY_MED, label='Apr 2025', edgecolor='none')
    ax1.set_xticks(x)
    ax1.set_xticklabels(dow_names, fontsize=8, color=SECONDARY)
    ax1.set_title('Avg Daily Revenue by Day of Week ($K)', fontsize=9, color=GRAY_DARK, fontweight='bold')
    ax1.legend(fontsize=7)
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=7, colors=SECONDARY)
    ax1.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)

    # Avg Check by DOW
    ax2 = fig.add_axes([0.55, 0.52, 0.42, 0.32])
    curr_ac_dow = [np.mean(dow_avgcheck.get(i, [0])) for i in range(7)]
    py_ac_dow = [np.mean(py_dow_avgcheck.get(i, [0])) for i in range(7)]
    ax2.bar([i - w/2 for i in x], curr_ac_dow, w, color=ORANGE, label='Apr 2026', edgecolor='none')
    ax2.bar([i + w/2 for i in x], py_ac_dow, w, color=GRAY_MED, label='Apr 2025', edgecolor='none')
    ax2.set_xticks(x)
    ax2.set_xticklabels(dow_names, fontsize=8, color=SECONDARY)
    ax2.set_title('Avg Check by Day of Week', fontsize=9, color=GRAY_DARK, fontweight='bold')
    ax2.legend(fontsize=7)
    ax2.spines['top'].set_visible(False)
    ax2.spines['right'].set_visible(False)
    ax2.spines['left'].set_color(GRAY_MED)
    ax2.spines['bottom'].set_color(GRAY_MED)
    ax2.tick_params(labelsize=7, colors=SECONDARY)
    ax2.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: f'${x:,.0f}'))
    ax2.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax2.set_facecolor(WHITE)

    # Table
    ax3 = fig.add_axes([0.07, 0.08, 0.88, 0.35])
    ax3.axis('off')
    table_data = []
    for i in range(7):
        avg_rev = dow_rev.get(i, 0) / max(dow_count.get(i, 1), 1)
        avg_cust = dow_customers.get(i, 0) / max(dow_count.get(i, 1), 1)
        avg_tc = dow_tickets.get(i, 0) / max(dow_count.get(i, 1), 1)
        avg_ac = np.mean(dow_avgcheck.get(i, [0]))
        py_avg_rev_v = py_dow_rev.get(i, 0) / max(py_dow_count.get(i, 1), 1)
        py_avg_cust_v = py_dow_customers.get(i, 0) / max(py_dow_count.get(i, 1), 1)
        rev_chg = ((avg_rev - py_avg_rev_v) / py_avg_rev_v * 100) if py_avg_rev_v else 0
        table_data.append([
            dow_names[i],
            f'{dow_count.get(i, 0)}',
            fmt_money(avg_rev),
            f'{avg_cust:.0f}',
            f'{avg_tc:.0f}',
            fmt_money(avg_ac),
            fmt_pct(rev_chg)
        ])
    col_labels = ['Day', 'Days', 'Avg Revenue', 'Avg Cust', 'Avg Tickets', 'Avg Check', 'vs PY']
    tbl = ax3.table(cellText=table_data, colLabels=col_labels,
                     loc='center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(7.5)
    tbl.scale(1, 1.5)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold')
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)
            # Color the vs PY column
            if key[1] == 6:
                val = table_data[key[0]-1][6]
                if val.startswith('+'):
                    cell.set_text_props(color=GREEN)
                elif val.startswith('-'):
                    cell.set_text_props(color=RED)

    add_footer(fig, 4)
    pdf.savefig(fig)
    plt.close()
    print("  Page 4: By Day of Week")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 5: FOOD & BEVERAGE AVG CHECK TRENDS
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Food & Beverage Average Check Trends')

    # Calculate monthly food/bev from supabase data (simplified with grupos)
    # For now use the last 15 months revenue and approximate food/bev split
    food_pct = food_rev / total_revenue if total_revenue else 0.58
    bev_pct = bev_rev / total_revenue if total_revenue else 0.33

    ax1 = fig.add_axes([0.07, 0.52, 0.88, 0.32])
    food_monthly = [monthly_rev.get(m, 0) * food_pct / max(monthly_tickets.get(m, 1), 1) for m in months_15]
    bev_monthly = [monthly_rev.get(m, 0) * bev_pct / max(monthly_tickets.get(m, 1), 1) for m in months_15]
    ax1.plot(range(len(months_15)), food_monthly, color=FOOD_COLOR, linewidth=2, marker='o',
             markersize=4, label='Food Avg Check')
    ax1.plot(range(len(months_15)), bev_monthly, color=BEV_COLOR, linewidth=2, marker='s',
             markersize=4, label='Beverage Avg Check')
    ax1.set_xticks(range(len(months_15)))
    ax1.set_xticklabels([datetime.strptime(m, '%Y-%m').strftime('%b %y') for m in months_15],
                         fontsize=6, rotation=45, color=SECONDARY)
    ax1.set_title('Food vs Beverage Average Check (15 Months)', fontsize=10, color=GRAY_DARK, fontweight='bold')
    ax1.legend(fontsize=8, loc='upper left')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=7, colors=SECONDARY)
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: f'${x:,.0f}'))
    ax1.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)

    # Food vs Bev comparison boxes for current month
    for i, (label, val, color, pct) in enumerate([
        ('Food Revenue', food_rev, FOOD_COLOR, food_pct * 100),
        ('Beverage Revenue', bev_rev, BEV_COLOR, bev_pct * 100),
        ('Market Revenue', market_rev, MARKET_COLOR, market_rev / total_revenue * 100 if total_revenue else 0),
    ]):
        x = 0.07 + i * 0.32
        fig.patches.append(FancyBboxPatch((x, 0.15), 0.28, 0.25,
                                           boxstyle="round,pad=0.01",
                                           facecolor=GRAY_LIGHT, edgecolor=color,
                                           transform=fig.transFigure, linewidth=2))
        fig.text(x + 0.14, 0.36, label, fontsize=10, color=GRAY_DARK,
                 ha='center', va='center', fontweight='bold')
        fig.text(x + 0.14, 0.30, fmt_money(val), fontsize=18, color=color,
                 ha='center', va='center', fontweight='bold')
        fig.text(x + 0.14, 0.22, f'{pct:.1f}% of total', fontsize=9, color=SECONDARY,
                 ha='center', va='center')
        fig.text(x + 0.14, 0.18, f'Avg/ticket: {fmt_money(val/total_tickets if total_tickets else 0)}',
                 fontsize=8, color=SECONDARY, ha='center', va='center')

    add_footer(fig, 5)
    pdf.savefig(fig)
    plt.close()
    print("  Page 5: Food & Beverage Avg Check Trends")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 6: FOOD REVENUE BY MONTH
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Food Revenue Breakdown')

    food_groups = [g for g in grupos if g['name'] not in BEVERAGE_GROUPS and g['name'] not in MARKET_GROUPS]
    food_groups = sorted(food_groups, key=lambda x: x['total'], reverse=True)[:15]

    ax1 = fig.add_axes([0.07, 0.08, 0.42, 0.78])
    names = [g['name'][:25] for g in food_groups]
    vals = [g['total'] / 1000 for g in food_groups]
    colors_bar = [PRIMARY if i % 2 == 0 else PRIMARY_LIGHT for i in range(len(names))]
    y_pos = range(len(names) - 1, -1, -1)
    ax1.barh(y_pos, vals, color=colors_bar, height=0.6, edgecolor='none')
    ax1.set_yticks(y_pos)
    ax1.set_yticklabels(names, fontsize=7, color=GRAY_DARK)
    ax1.set_xlabel('Revenue ($K)', fontsize=8, color=SECONDARY)
    ax1.set_title('Food Revenue by Group ($K)', fontsize=10, color=GRAY_DARK, fontweight='bold')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=7, colors=SECONDARY)
    ax1.grid(axis='x', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)
    for i, v in enumerate(vals):
        ax1.text(v + 0.5, list(y_pos)[i], f'${v:.1f}K', va='center', fontsize=6, color=SECONDARY)

    # Table
    ax2 = fig.add_axes([0.52, 0.08, 0.45, 0.78])
    ax2.axis('off')
    food_table = []
    for g in food_groups:
        food_table.append([g['name'][:22], fmt_money(g['total']), f"{g['pct']}%"])
    food_table.append(['TOTAL FOOD', fmt_money(food_rev), f'{food_rev/total_revenue*100:.1f}%'])
    tbl = ax2.table(cellText=food_table,
                     colLabels=['Group', 'Revenue', '% Total'],
                     loc='upper center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(7)
    tbl.scale(1, 1.3)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold')
        elif key[0] == len(food_table):
            cell.set_facecolor(PRIMARY_LIGHT)
            cell.set_text_props(fontweight='bold')
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)

    add_footer(fig, 6)
    pdf.savefig(fig)
    plt.close()
    print("  Page 6: Food Revenue")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 7: BEVERAGE REVENUE BY MONTH
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Beverage Revenue Breakdown')

    bev_groups = [g for g in grupos if g['name'] in BEVERAGE_GROUPS]
    bev_groups = sorted(bev_groups, key=lambda x: x['total'], reverse=True)

    ax1 = fig.add_axes([0.07, 0.15, 0.42, 0.70])
    names = [g['name'][:25] for g in bev_groups]
    vals = [g['total'] / 1000 for g in bev_groups]
    colors_bar = [BEV_COLOR if i % 2 == 0 else '#fcd34d' for i in range(len(names))]
    y_pos = range(len(names) - 1, -1, -1)
    ax1.barh(y_pos, vals, color=colors_bar, height=0.6, edgecolor='none')
    ax1.set_yticks(y_pos)
    ax1.set_yticklabels(names, fontsize=7.5, color=GRAY_DARK)
    ax1.set_xlabel('Revenue ($K)', fontsize=8, color=SECONDARY)
    ax1.set_title('Beverage Revenue by Group ($K)', fontsize=10, color=GRAY_DARK, fontweight='bold')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=7, colors=SECONDARY)
    ax1.grid(axis='x', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)
    for i, v in enumerate(vals):
        ax1.text(v + 0.5, list(y_pos)[i], f'${v:.1f}K', va='center', fontsize=6.5, color=SECONDARY)

    # Pie chart for beverage mix
    ax2 = fig.add_axes([0.55, 0.45, 0.40, 0.40])
    top_bev = bev_groups[:6]
    bev_pie_vals = [g['total'] for g in top_bev]
    other_bev = sum(g['total'] for g in bev_groups[6:])
    if other_bev > 0:
        bev_pie_vals.append(other_bev)
        bev_pie_labels = [g['name'][:15] for g in top_bev] + ['Other']
    else:
        bev_pie_labels = [g['name'][:15] for g in top_bev]
    bev_colors = ['#f59e0b', '#fbbf24', '#fcd34d', '#fde68a', '#fef3c7', '#d97706', '#92400e']
    ax2.pie(bev_pie_vals, labels=bev_pie_labels, colors=bev_colors[:len(bev_pie_vals)],
            autopct='%1.1f%%', textprops={'fontsize': 6.5}, pctdistance=0.8)
    ax2.set_title('Beverage Mix', fontsize=9, color=GRAY_DARK, fontweight='bold')

    # Summary box
    fig.patches.append(FancyBboxPatch((0.55, 0.15), 0.40, 0.22,
                                       boxstyle="round,pad=0.01",
                                       facecolor=GRAY_LIGHT, edgecolor=BEV_COLOR,
                                       transform=fig.transFigure, linewidth=1.5))
    fig.text(0.75, 0.33, 'Beverage Summary', fontsize=10, color=GRAY_DARK,
             ha='center', fontweight='bold')
    fig.text(0.75, 0.28, f'Total: {fmt_money(bev_rev)}', fontsize=12, color=BEV_COLOR,
             ha='center', fontweight='bold')
    fig.text(0.75, 0.23, f'{bev_rev/total_revenue*100:.1f}% of total revenue', fontsize=9,
             color=SECONDARY, ha='center')
    fig.text(0.75, 0.19, f'Coffee leads with {fmt_money(bev_groups[0]["total"])} ({bev_groups[0]["pct"]}%)',
             fontsize=7.5, color=SECONDARY, ha='center')

    add_footer(fig, 7)
    pdf.savefig(fig)
    plt.close()
    print("  Page 7: Beverage Revenue")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 8: BY DAY OF WEEK - REVENUE DETAIL
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Day of Week - Revenue Detail')

    # Group daily data by DOW with full breakdown
    ax1 = fig.add_axes([0.07, 0.45, 0.88, 0.40])
    total_by_dow = [dow_rev.get(i, 0) / 1000 for i in range(7)]
    bars = ax1.bar(dow_names, total_by_dow, color=PRIMARY, width=0.5, edgecolor='none')
    for bar, val in zip(bars, total_by_dow):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 1,
                 f'${val:.1f}K', ha='center', va='bottom', fontsize=8, color=GRAY_DARK, fontweight='bold')
    ax1.set_title('Total Revenue by Day of Week', fontsize=10, color=GRAY_DARK, fontweight='bold')
    ax1.set_ylabel('Revenue ($K)', fontsize=8, color=SECONDARY)
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=8, colors=SECONDARY)
    ax1.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)

    # Detailed table
    ax2 = fig.add_axes([0.07, 0.06, 0.88, 0.32])
    ax2.axis('off')
    detail_data = []
    for i in range(7):
        cnt = dow_count.get(i, 1) or 1
        detail_data.append([
            dow_names[i],
            f'{cnt}',
            fmt_money(dow_rev.get(i, 0)),
            fmt_money(dow_rev.get(i, 0) / cnt),
            f'{dow_customers.get(i, 0)}',
            f'{dow_customers.get(i, 0) / cnt:.0f}',
            f'{dow_tickets.get(i, 0)}',
            f'{dow_tickets.get(i, 0) / cnt:.0f}',
            fmt_money(np.mean(dow_avgcheck.get(i, [0]))),
        ])
    cols = ['Day', 'Days', 'Total Rev', 'Avg Rev/Day', 'Total Cust', 'Avg Cust/Day',
            'Total Tickets', 'Avg Tickets/Day', 'Avg Check']
    tbl = ax2.table(cellText=detail_data, colLabels=cols, loc='center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(6.5)
    tbl.scale(1, 1.5)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold')
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)

    add_footer(fig, 8)
    pdf.savefig(fig)
    plt.close()
    print("  Page 8: DOW Revenue Detail")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 9: BY DAY OF WEEK - CUSTOMERS DETAIL
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Day of Week - Customers & Tickets Detail')

    ax1 = fig.add_axes([0.07, 0.52, 0.42, 0.32])
    cust_by_dow = [dow_customers.get(i, 0) for i in range(7)]
    bars = ax1.bar(dow_names, cust_by_dow, color=GREEN, width=0.5, edgecolor='none')
    for bar, val in zip(bars, cust_by_dow):
        ax1.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5,
                 str(val), ha='center', va='bottom', fontsize=7, color=GRAY_DARK)
    ax1.set_title('Total Customers by DOW', fontsize=9, color=GRAY_DARK, fontweight='bold')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=7, colors=SECONDARY)
    ax1.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)

    ax2 = fig.add_axes([0.55, 0.52, 0.42, 0.32])
    tickets_by_dow = [dow_tickets.get(i, 0) for i in range(7)]
    bars = ax2.bar(dow_names, tickets_by_dow, color=ORANGE, width=0.5, edgecolor='none')
    for bar, val in zip(bars, tickets_by_dow):
        ax2.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 5,
                 str(val), ha='center', va='bottom', fontsize=7, color=GRAY_DARK)
    ax2.set_title('Total Tickets by DOW', fontsize=9, color=GRAY_DARK, fontweight='bold')
    ax2.spines['top'].set_visible(False)
    ax2.spines['right'].set_visible(False)
    ax2.spines['left'].set_color(GRAY_MED)
    ax2.spines['bottom'].set_color(GRAY_MED)
    ax2.tick_params(labelsize=7, colors=SECONDARY)
    ax2.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax2.set_facecolor(WHITE)

    # DOW comparison: current vs PY
    ax3 = fig.add_axes([0.07, 0.08, 0.88, 0.35])
    ax3.axis('off')
    comp_data = []
    for i in range(7):
        cnt = dow_count.get(i, 1) or 1
        py_cnt = py_dow_count.get(i, 1) or 1
        curr_avg_rev = dow_rev.get(i, 0) / cnt
        py_avg_rev_d = py_dow_rev.get(i, 0) / py_cnt
        curr_avg_cust = dow_customers.get(i, 0) / cnt
        py_avg_cust_d = py_dow_customers.get(i, 0) / py_cnt
        rev_chg = ((curr_avg_rev - py_avg_rev_d) / py_avg_rev_d * 100) if py_avg_rev_d else 0
        cust_chg = ((curr_avg_cust - py_avg_cust_d) / py_avg_cust_d * 100) if py_avg_cust_d else 0
        comp_data.append([
            dow_names[i],
            fmt_money(curr_avg_rev),
            fmt_money(py_avg_rev_d),
            fmt_pct(rev_chg),
            f'{curr_avg_cust:.0f}',
            f'{py_avg_cust_d:.0f}',
            fmt_pct(cust_chg),
        ])
    cols = ['Day', 'Avg Rev 2026', 'Avg Rev 2025', 'Rev Change', 'Avg Cust 2026', 'Avg Cust 2025', 'Cust Change']
    tbl = ax3.table(cellText=comp_data, colLabels=cols, loc='center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(7)
    tbl.scale(1, 1.5)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold')
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)
            if key[1] in (3, 6):
                val = comp_data[key[0]-1][key[1]]
                if val.startswith('+'):
                    cell.set_text_props(color=GREEN, fontweight='bold')
                elif val.startswith('-'):
                    cell.set_text_props(color=RED, fontweight='bold')

    add_footer(fig, 9)
    pdf.savefig(fig)
    plt.close()
    print("  Page 9: DOW Customers Detail")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 10: BY DAY OF WEEK - AVG CHECK BREAKDOWN
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Day of Week - Average Check & Occupancy')

    # Avg check heatmap-style
    ax1 = fig.add_axes([0.07, 0.52, 0.88, 0.32])
    weeks_in_month = defaultdict(lambda: defaultdict(list))
    for d in days:
        dt = datetime.strptime(d['fecha'], '%Y-%m-%d')
        week_num = (dt.day - 1) // 7
        dow = dt.weekday()
        weeks_in_month[week_num][dow].append(d.get('ticket_promedio_restaurant', 0))

    week_labels = ['Week 1', 'Week 2', 'Week 3', 'Week 4', 'Week 5']
    x = np.arange(7)
    width = 0.15
    colors_weeks = [PRIMARY_DARK, PRIMARY, PRIMARY_LIGHT, ORANGE, GREEN]
    for w in range(5):
        vals = [np.mean(weeks_in_month[w].get(d, [0])) for d in range(7)]
        if any(v > 0 for v in vals):
            ax1.bar(x + w * width, vals, width, label=week_labels[w],
                    color=colors_weeks[w], edgecolor='none')
    ax1.set_xticks(x + 2 * width)
    ax1.set_xticklabels(dow_names, fontsize=8, color=SECONDARY)
    ax1.set_title('Average Check by Week & Day of Week', fontsize=10, color=GRAY_DARK, fontweight='bold')
    ax1.legend(fontsize=7, ncol=5, loc='upper right')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=7, colors=SECONDARY)
    ax1.yaxis.set_major_formatter(mticker.FuncFormatter(lambda x, p: f'${x:,.0f}'))
    ax1.grid(axis='y', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)

    # Occupancy (customers) chart
    ax2 = fig.add_axes([0.07, 0.08, 0.88, 0.35])
    for w in range(5):
        vals = [sum(weeks_in_month[w].get(d, [0])) / max(len(weeks_in_month[w].get(d, [1])), 1)
                for d in range(7)]
        # Use customer counts instead
        pass

    # Weekly performance table
    ax2.axis('off')
    week_data = []
    for w in range(5):
        w_days = [d for d in days if (datetime.strptime(d['fecha'], '%Y-%m-%d').day - 1) // 7 == w]
        if not w_days:
            continue
        w_rev = sum(d['ventas_dia'] for d in w_days)
        w_tc = sum(d['tickets_count'] for d in w_days)
        w_cust = sum(d.get('personas_restaurant', 0) for d in w_days)
        w_ac = w_rev / w_tc if w_tc else 0
        week_data.append([
            week_labels[w],
            f'{len(w_days)}',
            fmt_money(w_rev),
            f'{w_tc}',
            f'{w_cust}',
            fmt_money(w_ac),
            fmt_money(w_rev / len(w_days)),
        ])
    cols = ['Week', 'Days', 'Revenue', 'Tickets', 'Customers', 'Avg Check', 'Avg Rev/Day']
    tbl = ax2.table(cellText=week_data, colLabels=cols, loc='center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(7.5)
    tbl.scale(1, 1.6)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold')
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)

    add_footer(fig, 10)
    pdf.savefig(fig)
    plt.close()
    print("  Page 10: DOW Avg Check Breakdown")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 11: DAILY - REVENUE, TICKETS, AVG CHECK
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Daily Performance - April 2026')

    ax1 = fig.add_axes([0.05, 0.08, 0.92, 0.80])
    ax1.axis('off')

    daily_data = []
    for d in days:
        dt = datetime.strptime(d['fecha'], '%Y-%m-%d')
        dow_name = dt.strftime('%a')
        daily_data.append([
            dt.strftime('%d'),
            dow_name,
            fmt_money(d['ventas_dia']),
            fmt_money(d['ventas_brutas']),
            fmt_money(d['descuentos']),
            f"{d['tickets_count']}",
            f"{d.get('personas_restaurant', 0)}",
            fmt_money(d.get('ticket_promedio_restaurant', 0)),
        ])
    # Add totals row
    daily_data.append([
        'TOTAL', '',
        fmt_money(total_revenue),
        fmt_money(sum(d['ventas_brutas'] for d in days)),
        fmt_money(sum(d['descuentos'] for d in days)),
        f'{total_tickets}',
        f'{total_customers}',
        fmt_money(avg_check),
    ])

    cols = ['Day', 'DOW', 'Net Revenue', 'Gross Revenue', 'Discounts', 'Tickets', 'Customers', 'Avg Check']
    tbl = ax1.table(cellText=daily_data, colLabels=cols, loc='upper center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(6)
    tbl.scale(1, 1.05)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        cell.set_height(0.028)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold', fontsize=7)
        elif key[0] == len(daily_data):
            cell.set_facecolor(PRIMARY_LIGHT)
            cell.set_text_props(fontweight='bold', fontsize=6.5)
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)
            # Highlight weekends
            if daily_data[key[0]-1][1] in ('Sat', 'Sun'):
                cell.set_facecolor('#eff6ff' if key[0] % 2 == 0 else '#dbeafe')

    add_footer(fig, 11)
    pdf.savefig(fig)
    plt.close()
    print("  Page 11: Daily Performance")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 12: FAVORITES - TOP ITEMS
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Favorites - Top Selling Items')

    # Top 20 saucers chart
    ax1 = fig.add_axes([0.05, 0.08, 0.45, 0.78])
    saucer_names = [s['name'][:25] for s in saucers_top20]
    saucer_vals = [s['total'] / 1000 for s in saucers_top20]
    y_pos = range(len(saucer_names) - 1, -1, -1)
    colors_s = [PRIMARY if i < 5 else (PRIMARY_LIGHT if i < 10 else GRAY_MED)
                for i in range(len(saucer_names))]
    ax1.barh(y_pos, saucer_vals, color=colors_s, height=0.6, edgecolor='none')
    ax1.set_yticks(y_pos)
    ax1.set_yticklabels(saucer_names, fontsize=6, color=GRAY_DARK)
    ax1.set_xlabel('Revenue ($K)', fontsize=7, color=SECONDARY)
    ax1.set_title('Top 20 Items by Revenue', fontsize=9, color=GRAY_DARK, fontweight='bold')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=6, colors=SECONDARY)
    ax1.grid(axis='x', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)

    # Table
    ax2 = fig.add_axes([0.53, 0.08, 0.44, 0.78])
    ax2.axis('off')
    saucer_table = []
    for s in saucers_top20:
        saucer_table.append([
            s['name'][:22],
            s['qty'],
            fmt_money(s['total']),
            f"{s['pct']}%",
        ])
    tbl = ax2.table(cellText=saucer_table,
                     colLabels=['Item', 'Qty', 'Revenue', '% Total'],
                     loc='upper center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(6.5)
    tbl.scale(1, 1.15)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold')
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)
            if key[0] <= 5:
                cell.set_text_props(fontweight='bold')

    add_footer(fig, 12)
    pdf.savefig(fig)
    plt.close()
    print("  Page 12: Favorites")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 13: eCOMMERCE - SALES BY CHANNEL
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'eCommerce & Sales by Channel')

    # Order types chart
    ax1 = fig.add_axes([0.07, 0.45, 0.42, 0.38])
    ot_names = [ot[0] for ot in order_types]
    ot_revenues = []
    for ot in order_types:
        rev_str = ot[4].replace('$', '').replace(',', '')
        ot_revenues.append(float(rev_str))
    ot_colors = [PRIMARY, BEV_COLOR, GREEN, ORANGE, RED]
    wedges, texts, autotexts = ax1.pie(ot_revenues, labels=ot_names, colors=ot_colors[:len(ot_names)],
                                        autopct='%1.1f%%', textprops={'fontsize': 7},
                                        pctdistance=0.8, startangle=90)
    ax1.set_title('Revenue by Order Type', fontsize=10, color=GRAY_DARK, fontweight='bold')

    # Payment methods
    ax2 = fig.add_axes([0.55, 0.45, 0.42, 0.38])
    pay_names = [p[0][:18] for p in payments]
    pay_vals = [float(p[1].replace('$', '').replace(',', '')) / 1000 for p in payments]
    pay_colors = [PRIMARY, PRIMARY_LIGHT, GREEN, ORANGE, '#8b5cf6', RED]
    bars = ax2.barh(range(len(pay_names) - 1, -1, -1), pay_vals,
                    color=pay_colors[:len(pay_names)], height=0.5, edgecolor='none')
    ax2.set_yticks(range(len(pay_names) - 1, -1, -1))
    ax2.set_yticklabels(pay_names, fontsize=7, color=GRAY_DARK)
    ax2.set_xlabel('Amount ($K)', fontsize=7, color=SECONDARY)
    ax2.set_title('Payment Methods', fontsize=10, color=GRAY_DARK, fontweight='bold')
    ax2.spines['top'].set_visible(False)
    ax2.spines['right'].set_visible(False)
    ax2.spines['left'].set_color(GRAY_MED)
    ax2.spines['bottom'].set_color(GRAY_MED)
    ax2.tick_params(labelsize=7, colors=SECONDARY)
    ax2.grid(axis='x', alpha=0.3, color=GRAY_MED)
    ax2.set_facecolor(WHITE)
    for bar, val in zip(bars, pay_vals):
        ax2.text(bar.get_width() + 2, bar.get_y() + bar.get_height()/2,
                 f'${val:.0f}K', va='center', fontsize=6.5, color=SECONDARY)

    # Order types table
    ax3 = fig.add_axes([0.07, 0.06, 0.88, 0.30])
    ax3.axis('off')
    ot_table = []
    for ot in order_types:
        ot_table.append(ot)
    cols = ['Channel', 'Avg Check', 'Tickets', 'Customers', 'Net Revenue', 'Gross Revenue']
    tbl = ax3.table(cellText=ot_table, colLabels=cols, loc='center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(7.5)
    tbl.scale(1, 1.6)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold')
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)

    add_footer(fig, 13)
    pdf.savefig(fig)
    plt.close()
    print("  Page 13: eCommerce")

    # ─────────────────────────────────────────────────────────────
    #  PAGE 14: SALES BY WAITER
    # ─────────────────────────────────────────────────────────────
    fig = new_page()
    add_title_bar(fig, 'Sales by Waiter - April 2026')

    # Chart
    ax1 = fig.add_axes([0.07, 0.45, 0.88, 0.40])
    waiter_names = [m['name'][:20] for m in meseros]
    waiter_vals = [m['total'] / 1000 for m in meseros]
    colors_w = [PRIMARY if i < 5 else (PRIMARY_LIGHT if i < 10 else GRAY_MED) for i in range(len(waiter_names))]
    bars = ax1.barh(range(len(waiter_names) - 1, -1, -1), waiter_vals,
                    color=colors_w, height=0.5, edgecolor='none')
    ax1.set_yticks(range(len(waiter_names) - 1, -1, -1))
    ax1.set_yticklabels(waiter_names, fontsize=6.5, color=GRAY_DARK)
    ax1.set_xlabel('Sales ($K)', fontsize=8, color=SECONDARY)
    ax1.set_title('Monthly Sales by Waiter', fontsize=10, color=GRAY_DARK, fontweight='bold')
    ax1.spines['top'].set_visible(False)
    ax1.spines['right'].set_visible(False)
    ax1.spines['left'].set_color(GRAY_MED)
    ax1.spines['bottom'].set_color(GRAY_MED)
    ax1.tick_params(labelsize=6.5, colors=SECONDARY)
    ax1.grid(axis='x', alpha=0.3, color=GRAY_MED)
    ax1.set_facecolor(WHITE)
    for bar, val in zip(bars, waiter_vals):
        ax1.text(bar.get_width() + 0.5, bar.get_y() + bar.get_height()/2,
                 f'${val:.1f}K', va='center', fontsize=5.5, color=SECONDARY)

    # Waiter table
    ax2 = fig.add_axes([0.07, 0.06, 0.88, 0.32])
    ax2.axis('off')
    waiter_table = []
    # Calculate tickets per waiter from daily data
    waiter_ticket_counts = defaultdict(int)
    waiter_day_counts = defaultdict(int)
    for d in days:
        if d.get('meseros'):
            ms = json.loads(d['meseros']) if isinstance(d['meseros'], str) else d['meseros']
            for m in ms:
                waiter_ticket_counts[m['nombre']] += 1
                waiter_day_counts[m['nombre']] += 1

    for m in meseros:
        tickets_est = waiter_day_counts.get(m['name'], 0)
        avg_per_ticket = m['total'] / tickets_est if tickets_est else 0
        waiter_table.append([
            m['name'][:25],
            fmt_money(m['total']),
            f"{m['pct']}%",
            f'{tickets_est}',
            fmt_money(avg_per_ticket) if tickets_est else '-',
        ])

    cols = ['Waiter', 'Total Sales', '% Share', 'Days Active', 'Avg Sales/Day']
    tbl = ax2.table(cellText=waiter_table, colLabels=cols, loc='upper center', cellLoc='center')
    tbl.auto_set_font_size(False)
    tbl.set_fontsize(6.5)
    tbl.scale(1, 1.15)
    for key, cell in tbl.get_celld().items():
        cell.set_edgecolor(GRAY_MED)
        if key[0] == 0:
            cell.set_facecolor(PRIMARY)
            cell.set_text_props(color=WHITE, fontweight='bold')
        else:
            cell.set_facecolor(WHITE if key[0] % 2 == 0 else GRAY_LIGHT)
            if key[0] <= 5:
                cell.set_text_props(fontweight='bold')

    add_footer(fig, 14)
    pdf.savefig(fig)
    plt.close()
    print("  Page 14: Sales by Waiter")

print(f"\nPDF generated successfully: {output_path}")
print(f"Total pages: 14")

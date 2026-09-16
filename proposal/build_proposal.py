# -*- coding: utf-8 -*-
"""Generates the Noir website proposal/agreement as a branded one-pager PDF."""

from reportlab.lib.pagesizes import A4
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, ListFlowable, ListItem, PageBreak, KeepTogether,
)

# ---- Noir brand palette ----
CORAL      = colors.HexColor("#ec8a86")
CORAL_DEEP = colors.HexColor("#c96a63")
INK        = colors.HexColor("#241615")
CREAM      = colors.HexColor("#fbeee7")
LINE       = colors.HexColor("#e6cfc6")
MUTED      = colors.HexColor("#7d6b66")

PAGE_W, PAGE_H = A4
MARGIN = 40
CONTENT_W = PAGE_W - 2 * MARGIN

# ---- Styles ----
title_style = ParagraphStyle("Title", fontName="Times-Bold", fontSize=30,
                              textColor=INK, leading=32)
kicker_style = ParagraphStyle("Kicker", fontName="Helvetica", fontSize=9.5,
                               textColor=INK, leading=13, spaceBefore=4)
meta_style = ParagraphStyle("Meta", fontName="Helvetica", fontSize=9.5,
                             textColor=INK, leading=14)
h2_style = ParagraphStyle("H2", fontName="Times-Bold", fontSize=14.5,
                           textColor=INK, spaceBefore=10, spaceAfter=5)
body_style = ParagraphStyle("Body", fontName="Helvetica", fontSize=10.2,
                             textColor=INK, leading=13.5, spaceAfter=4)
muted_style = ParagraphStyle("Muted", fontName="Helvetica-Oblique", fontSize=8.6,
                              textColor=MUTED, leading=12, spaceBefore=4)
bullet_style = ParagraphStyle("Bullet", fontName="Helvetica", fontSize=10,
                               textColor=INK, leading=14.5)
cell_style = ParagraphStyle("Cell", fontName="Helvetica", fontSize=8.8,
                             textColor=INK, leading=12)
cell_bold = ParagraphStyle("CellBold", fontName="Helvetica-Bold", fontSize=8.8,
                            textColor=INK, leading=12)
cell_head = ParagraphStyle("CellHead", fontName="Helvetica-Bold", fontSize=9,
                            textColor=INK, leading=12)
sign_label = ParagraphStyle("SignLabel", fontName="Helvetica", fontSize=9.5,
                             textColor=INK, leading=14)


def bullets(items, style=bullet_style):
    return ListFlowable(
        [ListItem(Paragraph(t, style), spaceBefore=2) for t in items],
        bulletType="bullet", start="•", bulletFontSize=8, leftIndent=14,
    )


def hr(color=LINE, thickness=0.8, space_after=10):
    return HRFlowable(width="100%", thickness=thickness, color=color, spaceAfter=space_after)


story = []

# ================= HEADER BAND =================
header_inner = [
    Paragraph("NOI<font color='#241615'>R</font>", ParagraphStyle(
        "HTitle", fontName="Times-Bold", fontSize=30, textColor=colors.white, leading=32)),
    Paragraph("WEBSITE PROPOSAL &amp; AGREEMENT", ParagraphStyle(
        "HSub", fontName="Helvetica", fontSize=9.5, textColor=colors.white,
        leading=14, spaceBefore=2)),
]
header_table = Table([[header_inner]], colWidths=[CONTENT_W])
header_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, -1), CORAL),
    ("LEFTPADDING", (0, 0), (-1, -1), 22),
    ("RIGHTPADDING", (0, 0), (-1, -1), 22),
    ("TOPPADDING", (0, 0), (-1, -1), 16),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 16),
]))
story.append(header_table)
story.append(Spacer(1, 10))

# ================= META ROW =================
meta_left = Paragraph(
    "<b>Prepared for</b><br/>Noir, Chocolate • Coffee • Cakes<br/>Serena",
    meta_style)
meta_right = Paragraph(
    "<b>Date:</b> July 27, 2026<br/><b>Prepared by:</b> Jad Seifeddine<br/>"
    "76 962 541 · jad.seifeddine24@gmail.com",
    meta_style)
meta_table = Table([[meta_left, meta_right]], colWidths=[CONTENT_W * 0.55, CONTENT_W * 0.45])
meta_table.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP")]))
story.append(meta_table)
story.append(Spacer(1, 4))
story.append(hr())

# ================= INTRO =================
story.append(Paragraph(
    "This proposal covers a complete ordering website for Noir, built to match your brand. "
    "It lets customers order chocolate, chocodonuts, cakes, coffee, and gifts online, and gives "
    "you a simple dashboard to manage everything yourself, from any phone.", body_style))

# ================= WHAT'S INCLUDED =================
story.append(Paragraph("What You're Getting", h2_style))
story.append(bullets([
    "A complete ordering website in your brand colors, with your real menu already loaded "
    "(Chocodonuts, Chocolate Boxes, Coffee, Desserts, and Sandwiches)",
    "A fast, single-page ordering experience: customers browse by category, add items with one "
    "tap, and check out from a bag that follows them as they shop",
    "Customers can schedule an order ahead, add a message for a cake, or send it as a gift to "
    "someone else with a note",
    "Mark any item sold out with one tap, so the menu always reflects what's actually available",
    "A dashboard that shows your revenue, best sellers, and every order in one place, with "
    "simple status tracking from new to completed",
    "Add products, update prices, and upload your own photos directly, no code needed",
    "Built to work cleanly on phones, both for you behind the counter and for your customers",
]))

# ================= INVESTMENT =================
inv_data = [
    [Paragraph("Website Build <font color='#7d6b66'>(one-time)</font>", cell_bold),
     Paragraph("$450", cell_bold)],
    [Paragraph("&nbsp;&nbsp;50% to begin", cell_style), Paragraph("$225", cell_style)],
    [Paragraph("&nbsp;&nbsp;50% at launch", cell_style), Paragraph("$225", cell_style)],
]
inv_table = Table(inv_data, colWidths=[CONTENT_W - 100, 100])
inv_table.setStyle(TableStyle([
    ("ALIGN", (1, 0), (1, -1), "RIGHT"),
    ("LINEBELOW", (0, 0), (-1, 0), 0.6, LINE),
    ("TOPPADDING", (0, 0), (-1, -1), 5),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
]))
story.append(KeepTogether([
    Paragraph("Investment", h2_style),
    inv_table,
    Paragraph("Flexible installment plans are available on request.", muted_style),
]))

# ================= ONGOING =================
story.append(KeepTogether([
    Paragraph("Hosting &amp; Support", h2_style),
    Paragraph(
        "<b>$100 per year</b>, billed annually starting at launch. This covers the actual "
        "hosting and domain costs, passed on to you directly. I don't take a margin or profit "
        "on this fee.", body_style),
]))
story.append(bullets([
    "Hosting, backups, and keeping the site live",
    "You manage your own products, prices, and photos, with no extra fee for that",
    "Small tweaks along the way (a wording fix, a quick setting change)",
]))
story.append(Paragraph("New features or a redesign are quoted separately, only if and when you want them.", muted_style))

# ================= TIMELINE & OWNERSHIP =================
story.append(KeepTogether([
    Paragraph("Timeline &amp; Ownership", h2_style),
    Paragraph(
        "What you've seen so far is the design and direction. From here, development continues: "
        "building out the full functionality, connecting it to hosting, and preparing it for "
        "launch. I'll confirm a target launch date once that work is underway.", body_style),
    Paragraph(
        "Once live, you own the website, its content, and your data outright. The ongoing fee "
        "simply keeps it hosted.", body_style),
]))

# ================= PAYMENTS NOTE =================
story.append(KeepTogether([
    Paragraph("A Note on Payments", h2_style),
    Paragraph(
        "The site is built around cash, the same way you take orders today. If you'd later like "
        "to accept Whish Money directly on the site, that can be added, but it isn't part of "
        "this build. It would need Whish's own approval, and we'd scope it together once you're "
        "ready.", body_style),
]))

# ================= WHY NOT SHOPIFY =================
story.append(KeepTogether([
    Paragraph("Why Not Just Use Shopify?", h2_style),
    Paragraph(
        "Shopify is a legitimate option and can run a basic store. For Noir specifically, though, "
        "it works out more expensive over time and fits less naturally with how you actually take "
        "orders.", body_style),
]))

def C(t, style=cell_style):
    return Paragraph(t, style)

shop_rows = [
    [C("", cell_head), C("Custom Noir Site", cell_head), C("Shopify (approx.)", cell_head)],
    [C("Year 1 cost", cell_bold), C("$550"), C("~$950 – $1,150")],
    [C("Every year after", cell_bold), C("$100"), C("~$800 – $1,000+")],
    [C("3-year total", cell_bold), C("~$750"), C("~$2,500 – $3,000+")],
    [C("Payments", cell_bold),
     C("Cash on delivery or pickup, already how you sell, with no added fees"),
     C("Free for cash on delivery too, but online or Whish payments later would need a "
       "3rd-party gateway plus a fee per sale, since Shopify Payments isn't available in Lebanon")],
    [C("Cake message, gifting, scheduling", cell_bold),
     C("Built in, exactly as you need it"),
     C("Needs paid apps or custom development to replicate")],
    [C("Your brand, exactly", cell_bold),
     C("Matches your real logo and colors from day one"),
     C("Needs a paid theme plus rework to match your identity")],
    [C("Ownership", cell_bold),
     C("Yours outright. Nothing disappears, even if you stop paying"),
     C("Rented. If you stop paying the subscription, the store goes offline")],
]
col_w = [118, (CONTENT_W - 118) / 2, (CONTENT_W - 118) / 2]
shop_table = Table(shop_rows, colWidths=col_w, repeatRows=1)
shop_table.setStyle(TableStyle([
    ("BACKGROUND", (0, 0), (-1, 0), CREAM),
    ("GRID", (0, 0), (-1, -1), 0.5, LINE),
    ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ("TOPPADDING", (0, 0), (-1, -1), 6),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
    ("LEFTPADDING", (0, 0), (-1, -1), 8),
    ("RIGHTPADDING", (0, 0), (-1, -1), 8),
]))
story.append(shop_table)
story.append(Paragraph(
    "Figures are estimates: Shopify's published Basic-plan pricing, plus typical costs for a "
    "premium theme and the extra apps needed to replicate cake messages, gift orders, and "
    "scheduling. Actual costs vary by the apps you choose. Confirm current Shopify pricing "
    "directly with them.", muted_style))
story.append(Spacer(1, 6))
story.append(Paragraph(
    "Shopify makes more sense for a business scaling fast across many products or locations, with "
    "no ongoing developer relationship. For a business Noir's size, with a cash-based model, the "
    "custom build costs less over time, fits exactly how you operate, and you own it outright.",
    body_style))

# ================= AGREEMENT =================
sign_data = [
    [Paragraph("<b>Client:</b> Noir", sign_label), Paragraph("<b>Developer</b>", sign_label)],
    [Spacer(1, 30), Spacer(1, 30)],
    [Paragraph("Name: ______________________", sign_label),
     Paragraph("Name: Jad Seifeddine", sign_label)],
    [Paragraph("Date: ______________________", sign_label),
     Paragraph("Date: ______________________", sign_label)],
]
sign_table = Table(sign_data, colWidths=[CONTENT_W / 2, CONTENT_W / 2])
sign_table.setStyle(TableStyle([
    ("TOPPADDING", (0, 0), (-1, -1), 3),
    ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
]))

story.append(Spacer(1, 10))
story.append(hr(thickness=0.8))
story.append(KeepTogether([
    Paragraph("Agreement", h2_style),
    Paragraph(
        "By confirming this proposal, whether in writing or by reply, both parties agree to the "
        "scope, pricing, and terms described above.", body_style),
    Spacer(1, 18),
    sign_table,
]))


def draw_footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(LINE)
    canvas.setLineWidth(0.6)
    canvas.line(MARGIN, 34, PAGE_W - MARGIN, 34)
    canvas.setFont("Helvetica", 7.6)
    canvas.setFillColor(MUTED)
    canvas.drawString(MARGIN, 22, "NOIR • Chocolate • Coffee • Cakes • Badaro, Beirut")
    canvas.drawRightString(PAGE_W - MARGIN, 22, f"Page {doc.page}")
    canvas.restoreState()


import sys
OUTPUT_NAME = sys.argv[1] if len(sys.argv) > 1 else "Noir - Website Proposal.pdf"
doc = SimpleDocTemplate(
    OUTPUT_NAME, pagesize=A4,
    topMargin=MARGIN, bottomMargin=MARGIN + 10, leftMargin=MARGIN, rightMargin=MARGIN,
    title="Noir Website Proposal & Agreement",
)
doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)
print("PDF written.")

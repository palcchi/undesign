#!/usr/bin/env python3
"""Build an original, source-controlled Undesign brand/icon draft.

This generator writes only inside /workspace/undesign-brand-assets. It does not
read or modify the live product checkout.
"""
from __future__ import annotations
import json
from pathlib import Path
from xml.sax.saxutils import escape

ROOT = Path(__file__).resolve().parent
ICON_DIR = ROOT / "icons"
LOGO_DIR = ROOT / "logo"

# The current registered Icon:: roles (170) were transcribed from the read-only
# audit of crates/ui-egui/src/icons.rs. This draft is independent of that source.
NAMES = """Move ToolbarSelect ToolbarFrame ToolbarShape ToolbarPen ToolbarText ToolbarComment ToolbarComponents ToolbarActions ToolbarDraw ToolbarDesign ToolbarDev ToolbarCode Scale Hand Frame Section Slice Rectangle Line Arrow Ellipse Polygon Star Image Pen Pencil Text TextOnPath Comment Actions Chevron ChevronRight ChevronLeft ChevronUp Plus Minus Eye EyeOff Lock Unlock Component Instance ComponentSet Group Vector Bend PaintBucket Lasso Cut Boolean Page Check Close WinMinimize WinMaximize WinRestore Search Grid AlignLeft AlignHCenter AlignRight AlignTop AlignVCenter AlignBottom DistributeH DistributeV Rotate FlipH FlipV CornerRadius CornerTopLeft CornerTopRight CornerBottomRight CornerBottomLeft Angle IndependentCorners IndependentPadding LinkOn LinkOff LayoutH LayoutV LayoutWrap LayoutGrid AutoLayout Effects Styles Menu Play Pause Home Bell Panels Help Dots Mask TextAlignLeft TextAlignCenter TextAlignRight TextAlignJustify TextTop TextMiddle TextBottom Eyedropper Code Assets Library Layers Opacity Blend Export StrokeIcon Fill GradientLinear GradientRadial GradientAngular GradientDiamond Sun Moon Undo Redo Union Subtract Intersect Exclude Hug FillContainer Fixed PaddingH PaddingV PaddingTop PaddingRight PaddingBottom PaddingLeft Gap Reset Detach Variable Clock Eraser VariableWidth ShapeBuilder ShapeBuilderRemove Swap Link Prototype Preview Logo AbsolutePosition Slot Adjust ViewList ViewGrid Reaction DragHandle ArcStart ArcSweep ArcRatio GamutWarning Online LiveShared LivePrivate PenNib Board Marker Highlighter Connector Shapes Stamp Measure""".split()
assert len(NAMES) == 170, len(NAMES)

# Each shape uses a 24px optical grid, currentColor, 1.7px strokes, and round
# joins/caps. Aliases are reserved for genuinely identical tool/surface roles.
ALIASES = {
    "ToolbarFrame": "Frame", "ToolbarShape": "Shapes", "ToolbarPen": "Pen",
    "ToolbarText": "Text", "ToolbarComment": "Comment",
    "ToolbarComponents": "Component", "ToolbarActions": "Actions",
    "ToolbarCode": "Code",
}

# Curated common glyphs. They deliberately use a restrained, architectural line
# language rather than importing a third-party icon pack.
G = {
"Move": '<circle cx="12" cy="12" r="2.1"/><path d="M12 3.5v5M12 15.5v5M3.5 12h5M15.5 12h5"/><path d="m10 5.6 2-2.1 2 2.1M10 18.4l2 2.1 2-2.1M5.6 10l-2.1 2 2.1 2M18.4 10l2.1 2-2.1 2"/>',
"ToolbarSelect": '<path d="M6 3.8 17.4 15l-5.2.6-2.3 4.6-3.9-16.4Z"/><path d="m14.2 16.5 3.2 3.1"/>',
"ToolbarDraw": '<path d="M4 17.5c3-8 5.1 3.4 8-4.8S16 9 20 5"/><circle cx="4" cy="17.5" r="1.2"/><circle cx="20" cy="5" r="1.2"/>',
"ToolbarDesign": '<path d="M5 19V5h14M5 12h7M12 5v7"/><path d="m14 18 4-4 2 2-4 4-3 1 1-3Z"/>',
"ToolbarDev": '<path d="m12 3.8 8.2 8.2-8.2 8.2L3.8 12 12 3.8Z"/><path d="m9.2 9.5-2.3 2.5 2.3 2.5M14.8 9.5l2.3 2.5-2.3 2.5"/>',
"Scale": '<path d="M4 17 17 4M7 4h10v10"/><path d="m4 7 3-3M17 20H7V10"/>',
"Hand": '<path d="M8 12V6a1.4 1.4 0 0 1 2.8 0v5-7a1.4 1.4 0 0 1 2.8 0v7-5a1.4 1.4 0 0 1 2.8 0v6-3a1.4 1.4 0 0 1 2.8 0v5.5c0 4-2.5 6.5-6.5 6.5h-1.4c-2 0-3.5-.8-4.5-2.4L4 14.7a1.6 1.6 0 0 1 2.5-2L8 14"/>',
"Frame": '<rect x="4" y="4" width="16" height="16" rx="1.4"/><path d="M8 7h8M8 10h3"/>',
"Section": '<rect x="3.5" y="5" width="17" height="14" rx="1.5"/><path d="M4 9h16M7 7h3"/>',
"Slice": '<path d="M8 4H5a1 1 0 0 0-1 1v3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 8h8v8H8z"/>',
"Rectangle": '<rect x="4" y="5" width="16" height="14" rx="1.2"/>',
"Line": '<path d="M4 18 20 6"/><circle cx="4" cy="18" r="1.2"/><circle cx="20" cy="6" r="1.2"/>',
"Arrow": '<path d="M4 12h15M14 7l5 5-5 5"/><circle cx="4" cy="12" r="1"/>',
"Ellipse": '<ellipse cx="12" cy="12" rx="8" ry="6.5"/>',
"Polygon": '<path d="m12 3.8 8 5.8-3.1 9.4H7.1L4 9.6l8-5.8Z"/>',
"Star": '<path d="m12 3.5 2.5 5.1 5.6.8-4 3.9 1 5.6-5.1-2.7-5.1 2.7 1-5.6-4-3.9 5.6-.8L12 3.5Z"/>',
"Image": '<rect x="3.8" y="4.5" width="16.4" height="15" rx="1.5"/><circle cx="9" cy="9" r="1.5"/><path d="m5 17 4.8-4.8 3.3 3 2.4-2.2 3.5 3.5"/>',
"Pen": '<path d="m4.5 19.5 4.2-1.1L19 8.1 15.9 5 5.3 15.6l-.8 3.9Z"/><path d="m13.8 7.1 3.1 3.1M5.2 15.6l3.1 3.1"/>',
"Pencil": '<path d="m5 16.5 10.8-10.8a2 2 0 0 1 2.8 2.8L7.8 19.3 4 20l1-3.5Z"/><path d="m14.4 7.1 3 3"/>',
"Text": '<path d="M5 5h14M12 5v14M8.5 19h7"/>',
"TextOnPath": '<path d="M4 18c3.5-9 12.5-9 16 0"/><path d="M9 7h6M12 7v5"/>',
"Comment": '<path d="M5 5.5h14a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-7l-5 3v-3H5a2 2 0 0 1-2-2v-8a2 2 0 0 1 2-2Z"/><path d="M7 10h10M7 13h6"/>',
"Actions": '<path d="m8.5 6-4 6 4 6M15.5 6l4 6-4 6"/><path d="M13 8.5 11 15.5"/>',
"Plus": '<path d="M12 5v14M5 12h14"/>',
"Minus": '<path d="M5 12h14"/>',
"Eye": '<path d="M3.5 12s3-5.5 8.5-5.5 8.5 5.5 8.5 5.5-3 5.5-8.5 5.5S3.5 12 3.5 12Z"/><circle cx="12" cy="12" r="2.4"/>',
"EyeOff": '<path d="m4 4 16 16M10.4 6.7c.5-.1 1-.2 1.6-.2 5.5 0 8.5 5.5 8.5 5.5a14.7 14.7 0 0 1-3 3.6M7.2 7.4C4.9 8.8 3.5 12 3.5 12s3 5.5 8.5 5.5c.8 0 1.6-.1 2.3-.4"/><path d="M10 10a2.8 2.8 0 0 0 4 4"/>',
"Lock": '<rect x="5" y="10" width="14" height="10" rx="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2.5"/>',
"Unlock": '<rect x="5" y="10" width="14" height="10" rx="1.6"/><path d="M8 10V7a4 4 0 0 1 7.5-1.8M12 14v2.5"/>',
"Component": '<rect x="4" y="4" width="9" height="9" rx="1.2"/><rect x="11" y="11" width="9" height="9" rx="1.2"/><path d="M7 7h3M14 14h3"/>',
"Instance": '<rect x="5" y="5" width="11" height="11" rx="1.2"/><path d="M9 19h9a1 1 0 0 0 1-1V9M8 8h5"/>',
"ComponentSet": '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><path d="M7.5 7.5h0M16.5 16.5h0"/>',
"Group": '<rect x="4" y="5" width="7" height="7" rx="1"/><circle cx="16.5" cy="8.5" r="3.5"/><path d="M5 17h14M8.5 15v4"/>',
"Vector": '<path d="M5 18 10 6l9 12H5Z"/><circle cx="5" cy="18" r="1.5"/><circle cx="10" cy="6" r="1.5"/><circle cx="19" cy="18" r="1.5"/>',
"Bend": '<path d="M5 18V9a4 4 0 0 1 4-4h9"/><path d="m14 2 4 3-4 3"/><circle cx="5" cy="18" r="1.2"/>',
"PaintBucket": '<path d="m7 4 10 10-5 5L2 9l5-5ZM5 7l8 8M16 15c2 1 3 2.3 3 4a2 2 0 0 1-4 0c0-1 .4-2.2 1-4Z"/>',
"Lasso": '<path d="M19.5 10.5c0 4-4.2 7-9.3 7-3.9 0-6.7-1.8-6.7-4.1 0-2.2 2.7-4.1 6.1-4.1 3 0 5.1 1.5 5.1 3.3 0 1.5-1.5 2.5-3.3 2.5-1.2 0-2.1-.6-2.1-1.4"/><path d="m9.3 13.7 5.2 6.2"/>',
"Cut": '<circle cx="6" cy="7" r="2.5"/><circle cx="6" cy="17" r="2.5"/><path d="m8.2 8.5 11 9M8.2 15.5l11-9M17 4l3 3-3 3"/>',
"Boolean": '<circle cx="9" cy="12" r="6"/><circle cx="15" cy="12" r="6"/><path d="M12 6.3v11.4"/>',
"Page": '<path d="M6 3.8h8l4 4V20H6z"/><path d="M14 4v4h4M9 12h6M9 15h6"/>',
"Check": '<path d="m5 12.5 4.2 4.2L19.5 6.5"/>',
"Close": '<path d="m6 6 12 12M18 6 6 18"/>',
"WinMinimize": '<path d="M5 17h14"/>',
"WinMaximize": '<rect x="5" y="5" width="14" height="14" rx="1.2"/>',
"WinRestore": '<path d="M8 5h10a1 1 0 0 1 1 1v10M5 8v10a1 1 0 0 0 1 1h10"/>',
"Search": '<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15 15 4.5 4.5"/>',
"Grid": '<rect x="4" y="4" width="6" height="6" rx=".8"/><rect x="14" y="4" width="6" height="6" rx=".8"/><rect x="4" y="14" width="6" height="6" rx=".8"/><rect x="14" y="14" width="6" height="6" rx=".8"/>',
"Rotate": '<path d="M19 8a7.5 7.5 0 0 0-13.3-2L4 8M4 4v4h4M5 16a7.5 7.5 0 0 0 13.3 2L20 16m0 4v-4h-4"/>',
"FlipH": '<path d="M12 4v16M4 7h6v10H4zM14 7h6v10h-6z"/><path d="m8 10-2 2 2 2M16 10l2 2-2 2"/>',
"FlipV": '<path d="M4 12h16M7 4v6h10V4zM7 14v6h10v-6z"/><path d="m10 8 2-2 2 2M10 16l2 2 2-2"/>',
"Angle": '<path d="M5 19V5M5 19h14M5 19a9 9 0 0 1 9-9"/><circle cx="14" cy="10" r="1"/>',
"IndependentCorners": '<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M4 9V5a1 1 0 0 1 1-1M15 4h4a1 1 0 0 1 1 1M20 15v4a1 1 0 0 1-1 1M9 20H5a1 1 0 0 1-1-1"/><circle cx="5" cy="5" r="1"/>',
"IndependentPadding": '<rect x="5" y="5" width="14" height="14" rx="1"/><path d="M12 5v3M19 12h-3M12 19v-3M5 12h3"/><path d="M9 12h6M12 9v6"/>',
"LinkOn": '<path d="M9.5 14.5 14.5 9.5M8 16H6.5a4 4 0 0 1 0-8H10M14 8h3.5a4 4 0 0 1 0 8H14"/>',
"LinkOff": '<path d="m4 4 16 16M9.5 14.5 12 12M8 16H6.5a4 4 0 0 1-3.3-6.2M14 8h3.5a4 4 0 0 1 3.3 6.2M10 8h4"/>',
"LayoutH": '<rect x="4" y="6" width="7" height="12" rx="1"/><rect x="13" y="6" width="7" height="12" rx="1"/><path d="M6 12h3M15 12h3"/>',
"LayoutV": '<rect x="6" y="4" width="12" height="7" rx="1"/><rect x="6" y="13" width="12" height="7" rx="1"/><path d="M12 6v3M12 15v3"/>',
"LayoutWrap": '<path d="M4 6h10a3 3 0 0 1 0 6H7a3 3 0 0 0 0 6h13"/><path d="m17 15 3 3-3 3"/>',
"LayoutGrid": '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/>',
"AutoLayout": '<rect x="4" y="4" width="16" height="16" rx="1.5"/><rect x="7" y="7" width="4" height="4" rx=".5"/><rect x="13" y="7" width="4" height="4" rx=".5"/><path d="M9 14v3M15 14v3M7 15.5h10"/>',
"Effects": '<path d="m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3Z"/><path d="m19 15 .7 2.3L22 18l-2.3.7L19 21l-.7-2.3L16 18l2.3-.7L19 15Z"/>',
"Styles": '<path d="M5 4.5h14v6H5zM5 13.5h6v6H5zM14 13.5h5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
"Menu": '<path d="M5 7h14M5 12h14M5 17h14"/>',
"Play": '<path d="M8 5.5v13l10-6.5-10-6.5Z"/>',
"Pause": '<path d="M8 5.5v13M16 5.5v13"/>',
"Home": '<path d="m3.5 10 8.5-6.5 8.5 6.5M5.5 9v10h13V9M9.5 19v-6h5v6"/>',
"Bell": '<path d="M18 9a6 6 0 0 0-12 0c0 7-2.5 7-2.5 9h17S18 16 18 9ZM10 21h4"/>',
"Panels": '<rect x="3.8" y="4.5" width="16.4" height="15" rx="1.5"/><path d="M9 5v14M12 8h5M12 11h5"/>',
"Help": '<circle cx="12" cy="12" r="8.5"/><path d="M9.5 9a2.6 2.6 0 1 1 4.4 1.9c-1.2 1-1.9 1.5-1.9 3.1M12 17.3v.1"/>',
"Dots": '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
"Mask": '<circle cx="12" cy="12" r="8"/><path d="M12 4v16M4 12h16"/><path d="M12 4a8 8 0 0 1 0 16Z"/>',
"Eyedropper": '<path d="m14.5 5.5 4 4-9.7 9.7-4.5 1 1-4.5 9.2-10.2ZM12.5 7.5l4 4M5 19l-1 1"/>',
"Code": '<path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 5l-4 14"/>',
"Assets": '<path d="M4 6.5h6l2 2h8v9.8a1.7 1.7 0 0 1-1.7 1.7H5.7A1.7 1.7 0 0 1 4 18.3V6.5Z"/><path d="M7 13h10M7 16h7"/>',
"Library": '<path d="M4 5.5c2.8-.8 5.5-.4 8 1v13c-2.5-1.4-5.2-1.8-8-1V5.5ZM20 5.5c-2.8-.8-5.5-.4-8 1v13c2.5-1.4 5.2-1.8 8-1V5.5Z"/>',
"Layers": '<path d="m12 3.5 8.5 4.7-8.5 4.7-8.5-4.7 8.5-4.7Z"/><path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5"/>',
"Opacity": '<path d="M12 3.5s6.5 7.2 6.5 11.2a6.5 6.5 0 0 1-13 0C5.5 10.7 12 3.5 12 3.5Z"/><path d="M8.5 15.5a3.5 3.5 0 0 0 3.5 3.5"/>',
"Blend": '<circle cx="9" cy="12" r="6.5"/><circle cx="15" cy="12" r="6.5"/><path d="M12 6.2a6.5 6.5 0 0 1 0 11.6"/>',
"Export": '<path d="M12 15V4M8 8l4-4 4 4"/><path d="M5 13v6h14v-6"/>',
"StrokeIcon": '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9h16"/><path d="M8 4v5" stroke-width="2.5"/>',
"Fill": '<rect x="4.5" y="4.5" width="15" height="15" rx="1.5"/><path d="M4.5 13h15v5a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18v-5Z"/>',
"Sun": '<circle cx="12" cy="12" r="3.5"/><path d="M12 2.8v3M12 18.2v3M2.8 12h3M18.2 12h3M5.5 5.5l2.1 2.1M16.4 16.4l2.1 2.1M18.5 5.5l-2.1 2.1M7.6 16.4l-2.1 2.1"/>',
"Moon": '<path d="M19.5 15.4A8 8 0 0 1 8.6 4.5 8.5 8.5 0 1 0 19.5 15.4Z"/>',
"Undo": '<path d="M9 8 4 12l5 4M4.5 12h8a6 6 0 0 1 6 6"/>',
"Redo": '<path d="m15 8 5 4-5 4m4.5-4h-8a6 6 0 0 0-6 6"/>',
"Union": '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/><path d="M7 7.3a5.5 5.5 0 0 0 0 9.4M17 7.3a5.5 5.5 0 0 1 0 9.4"/>',
"Subtract": '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/><path d="M12 6.6v10.8"/>',
"Intersect": '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/><path d="M12 7a5.5 5.5 0 0 1 0 10"/>',
"Exclude": '<circle cx="9" cy="12" r="5.5"/><circle cx="15" cy="12" r="5.5"/><path d="M9 7a5.5 5.5 0 0 1 0 10M15 7a5.5 5.5 0 0 0 0 10"/>',
"Hug": '<rect x="5" y="6" width="14" height="12" rx="1.5"/><path d="M8 9v6M16 9v6M8 12h2M16 12h-2"/>',
"FillContainer": '<rect x="4" y="5" width="16" height="14" rx="1.5"/><path d="m8 9-2 3 2 3M16 9l2 3-2 3M9 12h6"/>',
"Fixed": '<rect x="5" y="5" width="14" height="14" rx="1.5"/><path d="M9 9h6v6H9z"/>',
"Gap": '<path d="M4 5v14M20 5v14M8 12h8M10 9l-3 3 3 3M14 9l3 3-3 3"/>',
"Reset": '<path d="M5 8a7.5 7.5 0 1 1-.5 7M5 4v4h4"/><path d="M12 8v4l3 2"/>',
"Detach": '<path d="M9 15 6.5 17.5a3 3 0 0 1-4-4l4-4a3 3 0 0 1 4 0M15 9l2.5-2.5a3 3 0 0 1 4 4l-4 4a3 3 0 0 1-4 0M8 16l8-8"/><path d="m16 3 5 5"/>',
"Variable": '<path d="M5 8c2.5 0 2.5 8 5 8s2.5-8 5-8 2.5 8 5 8"/><circle cx="5" cy="8" r="1"/><circle cx="20" cy="16" r="1"/>',
"Clock": '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
"Eraser": '<path d="m4.5 14.5 9-9a2 2 0 0 1 2.8 0l3.2 3.2a2 2 0 0 1 0 2.8l-8 8H8l-3.5-3.5a1 1 0 0 1 0-1.5Z"/><path d="m9 10 6 6M11.5 19.5l3.5-3.5"/>',
"VariableWidth": '<path d="M4 12c3 0 3-5 8-5s5 5 8 5-3 5-8 5-5-5-8-5Z"/><path d="M12 4v3M12 17v3"/><circle cx="12" cy="4" r="1"/><circle cx="12" cy="20" r="1"/>',
"ShapeBuilder": '<path d="M4 8h7v7H4zM13 8h7v7h-7zM8.5 17h7v3h-7z"/><path d="M11 11.5h2M12 10.5v2"/>',
"ShapeBuilderRemove": '<path d="M4 8h7v7H4zM13 8h7v7h-7zM8.5 17h7v3h-7z"/><path d="M10.5 11.5h3"/>',
"Swap": '<path d="M4 8h15M16 5l3 3-3 3M20 16H5m3-3-3 3 3 3"/>',
"Link": '<path d="m9.5 14.5 5-5M8 16H6.5a4 4 0 0 1 0-8H10M14 8h3.5a4 4 0 0 1 0 8H14"/>',
"Prototype": '<rect x="4" y="5" width="7" height="14" rx="1.2"/><rect x="14" y="5" width="6" height="14" rx="1.2"/><path d="m11 12 3-2v4l-3-2Z"/>',
"Preview": '<rect x="3.8" y="5" width="16.4" height="14" rx="1.5"/><path d="M4 9h16M10 13v4l4-2-4-2Z"/>',
"Logo": '<path d="M5.2 4.5v9.1c0 4 2.8 6.7 6.8 6.7s6.8-2.7 6.8-6.7V9.2c0-2.3 1.3-3.7 3.1-4.2"/><path d="M18.5 5h3"/>',
"AbsolutePosition": '<rect x="5" y="5" width="14" height="14" rx="1.2"/><rect x="13" y="12" width="4" height="4" rx=".5"/><path d="M15 10v2M18 14h-1M9 5v2M5 10h2"/>',
"Slot": '<rect x="4" y="4" width="16" height="16" rx="1.5" stroke-dasharray="2.2 2.2"/><path d="M12 8v8M8 12h8"/>',
"Adjust": '<path d="M5 6h14M5 12h14M5 18h14"/><circle cx="9" cy="6" r="2" fill="none"/><circle cx="15" cy="12" r="2" fill="none"/><circle cx="11" cy="18" r="2" fill="none"/>',
"ViewList": '<path d="M9 6h11M9 12h11M9 18h11"/><rect x="4" y="4.5" width="2.5" height="2.5" rx=".3"/><rect x="4" y="10.5" width="2.5" height="2.5" rx=".3"/><rect x="4" y="16.5" width="2.5" height="2.5" rx=".3"/>',
"ViewGrid": '<rect x="4" y="4" width="7" height="7" rx="1"/><rect x="13" y="4" width="7" height="7" rx="1"/><rect x="4" y="13" width="7" height="7" rx="1"/><rect x="13" y="13" width="7" height="7" rx="1"/><path d="M7.5 7.5h0"/>',
"Reaction": '<circle cx="12" cy="12" r="8"/><path d="M8.5 14.2c.8 1.4 2 2.1 3.5 2.1s2.7-.7 3.5-2.1M9 9.5h.1M15 9.5h.1"/>',
"DragHandle": '<circle cx="8" cy="6" r=".9"/><circle cx="16" cy="6" r=".9"/><circle cx="8" cy="12" r=".9"/><circle cx="16" cy="12" r=".9"/><circle cx="8" cy="18" r=".9"/><circle cx="16" cy="18" r=".9"/>',
"GamutWarning": '<path d="m12 3.5 9 16H3l9-16Z"/><path d="M12 9v4.5M12 16.5v.1"/>',
"Online": '<circle cx="12" cy="12" r="8.5"/><path d="M3.7 12h16.6M12 3.5c2.3 2.4 3.3 5.2 3.3 8.5s-1 6.1-3.3 8.5c-2.3-2.4-3.3-5.2-3.3-8.5s1-6.1 3.3-8.5Z"/>',
"LiveShared": '<circle cx="12" cy="12" r="1.5"/><path d="M8.5 8.5a5 5 0 0 0 0 7M15.5 8.5a5 5 0 0 1 0 7M5.5 5.5a9 9 0 0 0 0 13M18.5 5.5a9 9 0 0 1 0 13"/>',
"LivePrivate": '<circle cx="12" cy="12" r="2"/><circle cx="12" cy="12" r="7.5"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2"/>',
"PenNib": '<path d="M12 3.5 19 10l-7 10.5L5 10l7-6.5Z"/><path d="m5 10 7 2 7-2M12 12v8.5"/><circle cx="12" cy="12" r="1"/>',
"Board": '<path d="M5 4.5h12l3 3V20H5z"/><path d="M17 4.5V8h3M8 11h9M8 14h7M8 17h5"/>',
"Marker": '<path d="m7 4 10 10-5 5L2 9l5-5Z"/><path d="m4.5 11.5 5 5M15 11l3 3"/>',
"Highlighter": '<path d="m6 5 13 13-3 3L3 8l3-3Z"/><path d="m8 3 13 13M4 12l8 8M3 19l2 2"/>',
"Connector": '<rect x="4" y="5" width="5" height="5" rx=".8"/><rect x="15" y="14" width="5" height="5" rx=".8"/><path d="M9 7.5h4a2 2 0 0 1 2 2V14"/><circle cx="9" cy="7.5" r=".7"/><circle cx="15" cy="14" r=".7"/>',
"Shapes": '<rect x="3.5" y="5" width="9" height="9" rx="1"/><circle cx="15.5" cy="15.5" r="5"/>',
"Stamp": '<path d="M9 4.5a3 3 0 1 1 6 0c0 2-1 3-1 4.5 0 1 .8 1.5 2 2.5l2 2v2H6v-2l2-2c1.2-1 2-1.5 2-2.5S9 6.5 9 4.5Z"/><path d="M5 19h14"/>',
"Measure": '<path d="M4 17 17 4M4 12v5h5M12 4h5v5M8 16l-1.5-1.5M11 13l-1.5-1.5M14 10l-1.5-1.5"/>',
}

# Reusable directional/measurement families with deliberate differences.
def chevron(name):
    d = {"Chevron": "M5 9l7 7 7-7", "ChevronRight": "M9 5l7 7-7 7", "ChevronLeft": "M15 5l-7 7 7 7", "ChevronUp": "M5 15l7-7 7 7"}[name]
    return f'<path d="{d}"/>'

def corner(name):
    corner_name = name.replace("Corner", "")
    d = {
        "TopLeft":"M5 11V6a1 1 0 0 1 1-1h5", "TopRight":"M13 5h5a1 1 0 0 1 1 1v5",
        "BottomRight":"M19 13v5a1 1 0 0 1-1 1h-5", "BottomLeft":"M11 19H6a1 1 0 0 1-1-1v-5"
    }[corner_name]
    return f'<rect x="4" y="4" width="16" height="16" rx="1.2"/><path d="{d}" stroke-width="2.4"/><circle cx="{ {"TopLeft":5,"TopRight":19,"BottomRight":19,"BottomLeft":5}[corner_name] }" cy="{ {"TopLeft":5,"TopRight":5,"BottomRight":19,"BottomLeft":19}[corner_name] }" r="1" fill="currentColor"/>'

def align(name):
    if name == "AlignLeft": return '<path d="M5 4v16"/><rect x="5" y="6" width="9" height="4" rx=".8"/><rect x="5" y="14" width="13" height="4" rx=".8"/>'
    if name == "AlignRight": return '<path d="M19 4v16"/><rect x="10" y="6" width="9" height="4" rx=".8"/><rect x="6" y="14" width="13" height="4" rx=".8"/>'
    if name == "AlignHCenter": return '<path d="M12 4v16"/><rect x="6" y="6" width="12" height="4" rx=".8"/><rect x="8" y="14" width="8" height="4" rx=".8"/>'
    if name == "AlignTop": return '<path d="M4 5h16"/><rect x="6" y="5" width="4" height="9" rx=".8"/><rect x="14" y="5" width="4" height="13" rx=".8"/>'
    if name == "AlignBottom": return '<path d="M4 19h16"/><rect x="6" y="10" width="4" height="9" rx=".8"/><rect x="14" y="6" width="4" height="13" rx=".8"/>'
    return '<path d="M4 12h16"/><rect x="6" y="6" width="4" height="12" rx=".8"/><rect x="14" y="8" width="4" height="8" rx=".8"/>'

def distribute(name):
    if name == "DistributeH": return '<path d="M4 5v14M20 5v14M7 12h10M9 9l-2 3 2 3M15 9l2 3-2 3"/><rect x="4.5" y="8" width="3" height="8" rx=".5"/><rect x="10.5" y="8" width="3" height="8" rx=".5"/><rect x="16.5" y="8" width="3" height="8" rx=".5"/>'
    return '<path d="M5 4h14M5 20h14M12 7v10M9 9l3-2 3 2M9 15l3 2 3-2"/><rect x="8" y="4.5" width="8" height="3" rx=".5"/><rect x="8" y="10.5" width="8" height="3" rx=".5"/><rect x="8" y="16.5" width="8" height="3" rx=".5"/>'

def padding(name):
    if name == "PaddingH": return '<rect x="4" y="6" width="16" height="12" rx="1"/><path d="M7 9v6M17 9v6M7 12h10M9 10l-2 2 2 2M15 10l2 2-2 2"/>'
    if name == "PaddingV": return '<rect x="6" y="4" width="12" height="16" rx="1"/><path d="M9 7h6M9 17h6M12 7v10M10 9l2-2 2 2M10 15l2 2 2-2"/>'
    side = name.replace("Padding", "")
    configs = {"Top":(12,5,12,8,"M10 7l2-2 2 2"),"Right":(19,12,16,12,"M17 10l2 2-2 2"),"Bottom":(12,19,12,16,"M10 17l2 2 2-2"),"Left":(5,12,8,12,"M7 10l-2 2 2 2")}
    x,y,ix,iy,arrow = configs[side]
    return f'<rect x="4" y="4" width="16" height="16" rx="1"/><path d="M{ix} {iy}L{x} {y}{arrow}"/>'

def text_align(name):
    base = {
      "TextAlignLeft": ["M5 6h14","M5 10h10","M5 14h14","M5 18h8"],
      "TextAlignCenter": ["M6 6h12","M8 10h8","M5 14h14","M7 18h10"],
      "TextAlignRight": ["M5 6h14","M9 10h10","M5 14h14","M11 18h8"],
      "TextAlignJustify": ["M5 6h14","M5 10h14","M5 14h14","M5 18h14"],
    }[name]
    return ''.join(f'<path d="{d}"/>' for d in base)

def text_vertical(name):
    ys = {"TextTop": (6,11,16), "TextMiddle": (8,12,16), "TextBottom": (8,13,18)}[name]
    return '<rect x="4" y="4" width="16" height="16" rx="1.2"/>' + ''.join(f'<path d="M8 {y}h8"/>' for y in ys) + '<path d="M6 4v2M18 18v2"/>'

def gradient(name):
    shape = '<rect x="4" y="4" width="16" height="16" rx="1.4"/>'
    if name == "GradientLinear": return shape + '<path d="M6 17 18 7M8 7h10v10"/><path d="M7 16h.1"/>'
    if name == "GradientRadial": return shape + '<circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="6.8"/>'
    if name == "GradientAngular": return shape + '<path d="M12 12 17.6 6.6M12 12V4.5M12 12h7.5M12 12l4.8 5.3"/>'
    return shape + '<path d="m12 5 7 7-7 7-7-7 7-7Z"/><path d="M12 5v14M5 12h14"/>'

def arc_icon(name):
    if name == "ArcStart": return '<circle cx="12" cy="12" r="8"/><path d="M12 12 17.7 6.3"/><circle cx="17.7" cy="6.3" r="1.2" fill="currentColor"/>'
    if name == "ArcSweep": return '<path d="M12 4a8 8 0 1 1-7.7 10"/><path d="m12 4 5.6 5.6H12V4Z"/>'
    return '<circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="3.2"/><path d="M12 5v3.8"/>'

def sizing(name):
    if name == "Hug": return G[name]
    if name == "FillContainer": return G[name]
    return G[name]

def glyph(name):
    if name in ALIASES:
        return glyph(ALIASES[name])
    if name == "Logo":
        return MARK
    if name in G:
        return G[name]
    if name.startswith("Chevron"):
        return chevron(name)
    if name == "CornerRadius":
        return '<path d="M5 19V8a3 3 0 0 1 3-3h11M5 19h14"/><path d="M9 19a4 4 0 0 1 4-4"/><circle cx="13" cy="15" r="1"/>'
    if name.startswith("CornerTop") or name.startswith("CornerBottom"):
        return corner(name)
    if name.startswith("Align"):
        return align(name)
    if name.startswith("Distribute"):
        return distribute(name)
    if name.startswith("Padding"):
        return padding(name)
    if name.startswith("TextAlign"):
        return text_align(name)
    if name in ("TextTop", "TextMiddle", "TextBottom"):
        return text_vertical(name)
    if name.startswith("Gradient"):
        return gradient(name)
    if name in ("ArcStart", "ArcSweep", "ArcRatio"):
        return arc_icon(name)
    if name == "Play": return G[name]
    raise KeyError(f"No original glyph defined for {name}")

# Assign each existing semantic role to a stable product family for navigation.
FAMILIES = {
"Brand": {"Logo"},
"Tools": set("Move ToolbarSelect ToolbarFrame ToolbarShape ToolbarPen ToolbarText ToolbarComment ToolbarComponents ToolbarActions ToolbarDraw ToolbarDesign ToolbarDev ToolbarCode Scale Hand Frame Section Slice Rectangle Line Arrow Ellipse Polygon Star Image Pen Pencil Text TextOnPath Comment Actions Lasso Cut PaintBucket Eyedropper Eraser ShapeBuilder ShapeBuilderRemove Marker Highlighter Connector Measure ArcStart ArcSweep ArcRatio VariableWidth".split()),
"Layers & assets": set("Component Instance ComponentSet Group Vector Boolean Page Assets Library Layers Mask Slot Detach AbsolutePosition Board Shapes Stamp".split()),
"Layout & type": set("AlignLeft AlignHCenter AlignRight AlignTop AlignVCenter AlignBottom DistributeH DistributeV CornerRadius CornerTopLeft CornerTopRight CornerBottomRight CornerBottomLeft Angle IndependentCorners IndependentPadding LayoutH LayoutV LayoutWrap LayoutGrid AutoLayout TextAlignLeft TextAlignCenter TextAlignRight TextAlignJustify TextTop TextMiddle TextBottom Hug FillContainer Fixed PaddingH PaddingV PaddingTop PaddingRight PaddingBottom PaddingLeft Gap".split()),
"Color & appearance": set("Effects Styles Opacity Blend StrokeIcon Fill GradientLinear GradientRadial GradientAngular GradientDiamond Sun Moon GamutWarning".split()),
"Motion & history": set("Play Pause Undo Redo Prototype Preview Clock Reset".split()),
"Collaboration": set("Comment Online LiveShared LivePrivate Reaction Bell".split()),
"Navigation & system": set("Chevron ChevronRight ChevronLeft ChevronUp Plus Minus Eye EyeOff Lock Unlock Check Close WinMinimize WinMaximize WinRestore Search Grid Menu Home Panels Help Dots Code Export Swap Link LinkOn LinkOff Variable Adjust ViewList ViewGrid DragHandle Rotate FlipH FlipV Union Subtract Intersect Exclude".split()),
}

def family_for(name):
    for label, members in FAMILIES.items():
        if name in members:
            return label
    return "Navigation & system"

def humanize(name):
    import re
    return re.sub(r"(?<=[a-z0-9])(?=[A-Z])", " ", name).replace("H Center", "horizontal center").replace("V Center", "vertical center")

def svg_doc(name, body, size=24):
    return f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {size} {size}" role="img" aria-labelledby="title"><title id="title">{escape(humanize(name))}</title><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">{body}</g></svg>\n'''

# Logo idea: an open, continuously drawn plane. The open terminal suggests an
# editable path; the broken upper-right contour avoids a generic filled tile mark.
MARK = '<path d="M5 10V7a2 2 0 0 1 2-2h6.5A5.5 5.5 0 0 1 19 10.5V12"/><path d="M19 14v3a2 2 0 0 1-2 2h-6.5A5.5 5.5 0 0 1 5 13.5V12"/>'


def write_logo_assets():
    mark = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 28" role="img" aria-labelledby="t"><title id="t">Undesign open-plane mark</title><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">{MARK}</g></svg>\n'''
    word = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 230 44" role="img" aria-labelledby="t"><title id="t">Undesign</title><g transform="translate(0 2) scale(1.42)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{MARK}</g><text x="42" y="32" fill="currentColor" font-family="Inter, ui-sans-serif, system-ui, sans-serif" font-size="31" font-weight="620" letter-spacing="-1.8">undesign</text></svg>\n'''
    app = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" role="img" aria-labelledby="t"><title id="t">Undesign app icon draft</title><rect x="16" y="16" width="480" height="480" rx="112" fill="#171A20"/><g transform="translate(76 76) scale(15)" fill="none" stroke="#F7F8FA" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">{MARK}</g></svg>\n'''
    favicon = f'''<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" role="img" aria-labelledby="t"><title id="t">Undesign favicon draft</title><g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">{MARK}</g></svg>\n'''
    (LOGO_DIR / "undesign-mark.svg").write_text(mark, encoding="utf-8")
    (LOGO_DIR / "undesign-wordmark.svg").write_text(word, encoding="utf-8")
    (LOGO_DIR / "app-icon.svg").write_text(app, encoding="utf-8")
    (LOGO_DIR / "favicon.svg").write_text(favicon, encoding="utf-8")


def write_icons_and_map():
    entries = []
    icon_bodies = {}
    for i, name in enumerate(NAMES):
        body = glyph(name)
        icon_bodies[name] = body
        svg = svg_doc(name, body)
        (ICON_DIR / f"{name}.svg").write_text(svg, encoding="utf-8")
        alias = ALIASES.get(name)
        entries.append({
            "role": name,
            "label": humanize(name),
            "family": family_for(name),
            "glyph": alias or name,
            "asset": f"icons/{name}.svg",
            "aliasOf": alias,
            "defaultColor": "neutral-ink",
            "activeColor": "selection-blue",
            "index": i,
        })
    payload = {
        "title": "Undesign icon role map — draft",
        "sourceInventory": "Read-only Icon::ALL inventory from crates/ui-egui/src/icons.rs at draft time; 170 roles.",
        "iconGrid": {"viewBox": "0 0 24 24", "strokeWidth": 1.7, "lineCap": "round", "lineJoin": "round", "default": "currentColor / neutral ink", "selected": "currentColor / selection blue"},
        "aliases": ALIASES,
        "roles": entries,
    }
    (ROOT / "icon-map.json").write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (ROOT / "glyph-bodies.json").write_text(json.dumps(icon_bodies, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return payload, icon_bodies


def write_preview(payload, icon_bodies):
    data = json.dumps(payload["roles"], separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")
    bodies = json.dumps(icon_bodies, separators=(",", ":"), ensure_ascii=False).replace("</", "<\\/")
    families = list(FAMILIES.keys())
    family_buttons = ''.join(f'<button class="filter" data-family="{escape(x)}">{escape(x)}</button>' for x in families)
    html = r'''<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Undesign — brand and icon draft</title>
<style>
:root{--ink:#20242b;--muted:#747b85;--paper:#fff;--fog:#f5f6f8;--line:#e2e5ea;--blue:#315bff;--dark:#171a20;--font:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--font);font-size:14px;line-height:1.5}button,input{font:inherit}a{color:inherit}.wrap{max-width:1320px;margin:0 auto;padding:0 44px}.top{height:64px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between}.topmark{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:650;letter-spacing:-.03em}.topmark svg{width:24px;height:24px}.tag{color:var(--muted);font-size:12px}.hero{padding:78px 0 54px;display:grid;grid-template-columns:1.2fr .8fr;gap:56px;align-items:center}.eyebrow{font-size:12px;font-weight:600;color:var(--muted);margin:0 0 20px}.hero h1{font-size:clamp(42px,6vw,76px);letter-spacing:-.075em;line-height:.98;font-weight:620;margin:0 0 22px;max-width:650px}.hero p{font-size:16px;color:#626973;max-width:485px;margin:0}.hero-art{display:grid;grid-template-columns:1fr 146px;gap:18px;align-items:end}.wordbox{min-height:160px;display:flex;align-items:center;justify-content:center;background:var(--fog);padding:24px}.wordbox svg{width:min(100%,300px);height:auto}.appbox{aspect-ratio:1;border-radius:28px;display:grid;place-items:center;background:var(--dark);box-shadow:0 0 0 1px rgba(25,29,36,.08)}.appbox svg{width:66%;height:66%}.hero-label{grid-column:1/-1;display:flex;justify-content:space-between;color:var(--muted);font-size:11px;margin-top:4px}.section{border-top:1px solid var(--line);padding:36px 0 54px}.sectionhead{display:flex;align-items:end;justify-content:space-between;gap:24px;margin-bottom:24px}.section h2{font-size:24px;letter-spacing:-.045em;line-height:1.1;margin:0 0 7px;font-weight:620}.sectionhead p{margin:0;color:var(--muted);max-width:620px}.tokens{display:flex;gap:8px;flex-wrap:wrap}.token{display:flex;align-items:center;gap:8px;border:1px solid var(--line);padding:7px 10px;color:#555d68;font-size:12px}.swatch{width:13px;height:13px;border-radius:2px;border:1px solid rgba(0,0,0,.08)}.principles{display:grid;grid-template-columns:repeat(3,1fr);border-top:1px solid var(--line);margin-top:30px}.principle{padding:18px 20px 0 0}.principle strong{display:block;font-size:13px;margin-bottom:5px}.principle span{color:var(--muted);font-size:12px}.examples{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line)}.example{min-height:120px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);padding:18px;display:flex;flex-direction:column;justify-content:space-between}.example label{font-size:11px;color:var(--muted)}.example svg{width:24px;height:24px}.example.selected{color:var(--blue);background:#f7f9ff}.example.selected label{color:var(--blue)}.ring{width:32px;height:32px;border:1px solid var(--blue);box-shadow:0 0 0 3px rgba(49,91,255,.16);display:grid;place-items:center;border-radius:4px;color:var(--blue)}
.toolbar{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.tool{width:34px;height:34px;display:grid;place-items:center;border:1px solid transparent;border-radius:7px;color:#414750}.tool svg{width:20px;height:20px}.tool.on{background:rgba(49,91,255,.08);border-color:rgba(49,91,255,.18);color:var(--blue)}.tool.on svg{fill:rgba(49,91,255,.1)}
.iconhead{align-items:center}.search{width:min(270px,100%);border:1px solid var(--line);height:38px;padding:0 12px;color:var(--ink);outline:none;background:white}.search:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(49,91,255,.14)}.filters{display:flex;gap:6px;flex-wrap:wrap;margin:0 0 18px}.filter{border:1px solid var(--line);background:white;padding:6px 10px;color:#626973;font-size:12px;cursor:pointer;border-radius:4px}.filter.active{background:var(--ink);border-color:var(--ink);color:white}.count{font-size:12px;color:var(--muted);white-space:nowrap}.icon-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));border-top:1px solid var(--line);border-left:1px solid var(--line)}.icon-cell{min-width:0;min-height:88px;padding:12px 10px 10px;border-right:1px solid var(--line);border-bottom:1px solid var(--line);display:flex;flex-direction:column;justify-content:space-between;color:var(--ink)}.icon-cell svg{width:22px;height:22px}.icon-cell span{font-size:10px;color:#737b84;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.icon-cell:hover{background:var(--fog)}.icon-cell.state-demo{color:var(--blue);background:#f8faff}.footer{border-top:1px solid var(--line);padding:26px 0 40px;color:var(--muted);font-size:12px;display:flex;justify-content:space-between;gap:24px}.note{padding:14px 16px;border-left:2px solid var(--blue);background:#f7f9ff;color:#4b5563;font-size:13px;margin-top:22px}.mobile-brand{display:none}
@media(max-width:900px){.wrap{padding:0 24px}.hero{gap:28px;grid-template-columns:1fr .85fr}.hero-art{grid-template-columns:1fr 110px}.icon-grid{grid-template-columns:repeat(6,minmax(0,1fr))}.examples{grid-template-columns:repeat(2,1fr)}}
@media(max-width:600px){.wrap{padding:0 16px}.top{height:56px}.hero{padding:48px 0 38px;grid-template-columns:1fr;gap:30px}.hero h1{font-size:52px}.hero-art{grid-template-columns:1fr 104px;max-width:480px}.wordbox{min-height:128px}.section{padding:28px 0 40px}.sectionhead{align-items:flex-start;flex-direction:column}.sectionhead.iconhead{flex-direction:column}.sectionhead .search{width:100%}.icon-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.icon-cell{min-height:78px;padding:9px}.icon-cell span{font-size:9px}.principles{grid-template-columns:1fr}.principle{padding-top:14px}.footer{flex-direction:column}.tag{font-size:10px}}
</style></head><body><div class="wrap">
<header class="top"><div class="topmark"><svg viewBox="0 0 28 28" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">__MARK__</g></svg><span>undesign</span></div><span class="tag">Brand / icon direction · draft 01</span></header>
<main>
<section class="hero"><div><p class="eyebrow">A new visual grammar for the open canvas</p><h1>Make room<br>for the work.</h1><p>A quieter, more deliberate identity: one paired open-plane mark, one disciplined line system for the interface, and cobalt only when a state needs attention.</p></div><div class="hero-art"><div class="wordbox"><svg viewBox="0 0 230 44" aria-label="Undesign wordmark draft"><g transform="translate(0 2) scale(1.42)" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">__MARK__</g><text x="42" y="32" fill="currentColor" font-family="Inter,ui-sans-serif,system-ui,sans-serif" font-size="31" font-weight="620" letter-spacing="-1.8">undesign</text></svg></div><div class="appbox"><svg viewBox="0 0 28 28" aria-label="App icon mark"><g fill="none" stroke="#F7F8FA" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">__MARK__</g></svg></div><div class="hero-label"><span>Wordmark / neutral</span><span>App tile / graphite</span></div></div></section>
<section class="section"><div class="sectionhead"><div><h2>Color, with a job</h2><p>Blue is the only accent. It marks selection, focus, and active tools; it does not decorate the brand mark or idle interface.</p></div></div><div class="tokens"><div class="token"><i class="swatch" style="background:#20242b"></i>Ink · #20242B</div><div class="token"><i class="swatch" style="background:#f5f6f8"></i>Fog · #F5F6F8</div><div class="token"><i class="swatch" style="background:#fff"></i>Paper · #FFFFFF</div><div class="token"><i class="swatch" style="background:#747b85"></i>Muted · #747B85</div><div class="token"><i class="swatch" style="background:#e2e5ea"></i>Line · #E2E5EA</div><div class="token"><i class="swatch" style="background:#315bff"></i>Selection blue · #315BFF</div></div><div class="principles"><div class="principle"><strong>One optical grid</strong><span>24px viewBox, 1.7px stroke, rounded joins and consistent breathing room.</span></div><div class="principle"><strong>One meaning per glyph</strong><span>Similar actions stay related; different actions stop borrowing the same shape.</span></div><div class="principle"><strong>State, not decoration</strong><span>Default icons remain neutral; selected and focused states use the single blue token.</span></div></div></section>
<section class="section"><div class="sectionhead"><div><h2>State test</h2><p>The mark and idle icons stay neutral. Selection and keyboard focus are the only blue moments.</p></div></div><div class="examples"><div class="example"><label>Idle tool</label><div class="toolbar"><span class="tool"><svg viewBox="0 0 24 24">__ICON_MOVE__</svg></span><span class="tool"><svg viewBox="0 0 24 24">__ICON_FRAME__</svg></span></div></div><div class="example selected"><label>Selected tool</label><div class="toolbar"><span class="tool on"><svg viewBox="0 0 24 24">__ICON_SELECT__</svg></span><span class="tool"><svg viewBox="0 0 24 24">__ICON_PEN__</svg></span></div></div><div class="example"><label>Default icon</label><svg viewBox="0 0 24 24">__ICON_LAYER__</svg></div><div class="example"><label>Keyboard focus</label><span class="ring"><svg viewBox="0 0 24 24">__ICON_SEARCH__</svg></span></div></div><div class="note">The files are a review draft only. No active app, web, showcase, or packaging source has been changed.</div></section>
<section class="section"><div class="sectionhead iconhead"><div><h2>The full role map</h2><p>Every currently registered product icon role is represented below. Search by role or filter by area.</p></div><input id="search" class="search" type="search" placeholder="Search icon roles" aria-label="Search icon roles"></div><nav class="filters" aria-label="Filter icons"><button class="filter active" data-family="All">All roles</button>__FILTERS__</nav><div id="count" class="count"></div><div id="grid" class="icon-grid" style="margin-top:10px"></div></section>
</main><footer class="footer"><span>Undesign identity direction / editable SVG assets / not yet integrated</span><span>170 registered roles · original draft artwork</span></footer></div>
<script>
const roles=__ROLES__;
const bodies=__BODIES__;
const grid=document.querySelector('#grid');const search=document.querySelector('#search');const count=document.querySelector('#count');let active='All';
function iconSvg(role){return `<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">${bodies[role.glyph]}</g></svg>`}
function draw(){const q=search.value.trim().toLowerCase();const shown=roles.filter(r=>(active==='All'||r.family===active)&&(!q||r.role.toLowerCase().includes(q)||r.label.toLowerCase().includes(q)));count.textContent=`${shown.length} of ${roles.length} icon roles`;grid.innerHTML=shown.map(r=>`<div class="icon-cell" title="${r.role}${r.aliasOf?` · same meaning as ${r.aliasOf}`:''}">${iconSvg(r)}<span>${r.role}</span></div>`).join('')}
document.querySelectorAll('.filter').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.filter').forEach(x=>x.classList.remove('active'));b.classList.add('active');active=b.dataset.family;draw()}));search.addEventListener('input',draw);draw();
</script></body></html>'''
    filters = ''.join(f'<button class="filter" data-family="{escape(x)}">{escape(x)}</button>' for x in families)
    reps = {"__MARK__": MARK, "__ICON_MOVE__": icon_bodies["Move"], "__ICON_FRAME__": icon_bodies["Frame"], "__ICON_SELECT__": icon_bodies["ToolbarSelect"], "__ICON_PEN__": icon_bodies["Pen"], "__ICON_LAYER__": icon_bodies["Layers"], "__ICON_SEARCH__": icon_bodies["Search"], "__FILTERS__": filters, "__ROLES__": data, "__BODIES__": bodies}
    for key, value in reps.items():
        html = html.replace(key, value)
    (ROOT / "preview.html").write_text(html, encoding="utf-8")


def main():
    write_logo_assets()
    payload, bodies = write_icons_and_map()
    write_preview(payload, bodies)
    print(f"Built {len(payload['roles'])} icon-role SVGs, {len(payload['aliases'])} deliberate aliases, logo variants, mapping, and preview in {ROOT}")

if __name__ == "__main__":
    main()

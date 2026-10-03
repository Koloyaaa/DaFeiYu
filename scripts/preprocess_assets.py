"""Remove the near-white backdrop from the provided character art.

The source drawings all use a near-white, almost neutral background.  This
script flood-fills only those near-white pixels connected to the image edge,
preserving white details enclosed by the illustration, then writes padded RGBA
PNGs and simplified alpha-derived polygon hitboxes for the browser game.

Requirements: Pillow, NumPy, SciPy (ndimage).
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
from PIL import Image
from scipy import ndimage


ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIR = ROOT / "Assets" / "images"
OUTPUT_DIR = ROOT / "Assets" / "processed"
OUTPUT_SIZE = 512
CONTENT_FIT = 0.91
PROGRESSION_ORDER = [
    "豆包",
    "Mistral",
    "Gemini",
    "MuseSpark",
    "GLM",
    "Qwen",
    "Kimi",
    "Grok",
    "Claude",
    "ChatGPT",
    "DeepSeek",
]

# Pixels must be bright and almost neutral to qualify as background.  The
# connected-component step is what keeps white hair, eyes and decorations.
BACKGROUND_MIN_CHANNEL = 228
BACKGROUND_MAX_SPREAD = 42
ALPHA_FADE_START = 7.0
ALPHA_FADE_END = 42.0
ALPHA_BOUNDS_THRESHOLD = 24
COLLISION_POLYGON_MAX_POINTS = 32
COLLISION_POLYGON_TOLERANCE = 0.65
COLLISION_ALPHA_THRESHOLD = 24


def connected_background(rgb: np.ndarray) -> np.ndarray:
    low = rgb.min(axis=2)
    high = rgb.max(axis=2)
    candidate = (low >= BACKGROUND_MIN_CHANNEL) & (
        high - low <= BACKGROUND_MAX_SPREAD
    )
    seeds = np.zeros(candidate.shape, dtype=bool)
    seeds[0, :] = candidate[0, :]
    seeds[-1, :] = candidate[-1, :]
    seeds[:, 0] = candidate[:, 0]
    seeds[:, -1] = candidate[:, -1]
    return ndimage.binary_propagation(
        seeds,
        structure=np.ones((3, 3), dtype=bool),
        mask=candidate,
    )


def trace_outer_contour(binary_mask: np.ndarray) -> list[tuple[int, int]]:
    """Trace the largest exterior loop along the pixel-cell edges."""
    filled = ndimage.binary_fill_holes(binary_mask)
    labels, label_count = ndimage.label(filled)
    if label_count == 0:
        return []
    sizes = np.bincount(labels.ravel())
    sizes[0] = 0
    filled = labels == int(np.argmax(sizes))
    height, width = filled.shape
    edges: set[tuple[tuple[int, int], tuple[int, int]]] = set()
    outgoing: dict[tuple[int, int], list[tuple[int, int]]] = {}

    def add_edge(start: tuple[int, int], end: tuple[int, int]) -> None:
        edges.add((start, end))
        outgoing.setdefault(start, []).append(end)

    for y, x in zip(*np.nonzero(filled)):
        x = int(x)
        y = int(y)
        if y == 0 or not filled[y - 1, x]:
            add_edge((x, y), (x + 1, y))
        if x == width - 1 or not filled[y, x + 1]:
            add_edge((x + 1, y), (x + 1, y + 1))
        if y == height - 1 or not filled[y + 1, x]:
            add_edge((x + 1, y + 1), (x, y + 1))
        if x == 0 or not filled[y, x - 1]:
            add_edge((x, y + 1), (x, y))

    remaining = edges.copy()
    loops: list[list[tuple[int, int]]] = []
    direction_index = {(1, 0): 0, (0, 1): 1, (-1, 0): 2, (0, -1): 3}
    turn_priority = {1: 0, 0: 1, 3: 2, 2: 3}
    while remaining:
        start, current = next(iter(remaining))
        loop = [start]
        for _ in range(len(edges) + 1):
            incoming = (current[0] - loop[-1][0], current[1] - loop[-1][1])
            previous_direction = direction_index[incoming]
            remaining.discard((loop[-1], current))
            if current == loop[0]:
                break
            loop.append(current)
            choices = [point for point in outgoing.get(current, ()) if (current, point) in remaining]
            if not choices:
                break
            current_direction = previous_direction
            current = min(
                choices,
                key=lambda point: turn_priority[
                    (direction_index[(point[0] - current[0], point[1] - current[1])] - current_direction) % 4
                ],
            )
        if len(loop) >= 3 and current == loop[0]:
            loops.append(loop)

    if not loops:
        return []
    return max(loops, key=lambda points: abs(polygon_area(points)))


def polygon_area(points: list[tuple[float, float]]) -> float:
    return sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    ) / 2.0


def simplify_open_path(points: list[tuple[int, int]], tolerance: float) -> list[tuple[int, int]]:
    if len(points) <= 2:
        return points
    tolerance_squared = tolerance * tolerance
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    segments = [(0, len(points) - 1)]
    while segments:
        start, end = segments.pop()
        x1, y1 = points[start]
        x2, y2 = points[end]
        dx = x2 - x1
        dy = y2 - y1
        length_squared = dx * dx + dy * dy
        farthest = -1
        farthest_distance = tolerance_squared
        for index in range(start + 1, end):
            px, py = points[index]
            if length_squared:
                projection = max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / length_squared))
                nearest_x = x1 + projection * dx
                nearest_y = y1 + projection * dy
            else:
                nearest_x, nearest_y = x1, y1
            distance = (px - nearest_x) ** 2 + (py - nearest_y) ** 2
            if distance > farthest_distance:
                farthest = index
                farthest_distance = distance
        if farthest >= 0:
            keep[farthest] = True
            segments.append((start, farthest))
            segments.append((farthest, end))
    return [point for index, point in enumerate(points) if keep[index]]


def simplify_closed_contour(points: list[tuple[int, int]]) -> list[tuple[int, int]]:
    if len(points) <= 3:
        return points
    split = max(
        range(1, len(points)),
        key=lambda index: (points[index][0] - points[0][0]) ** 2 + (points[index][1] - points[0][1]) ** 2,
    )
    first = simplify_open_path(points[: split + 1], COLLISION_POLYGON_TOLERANCE)
    second = simplify_open_path(points[split:] + [points[0]], COLLISION_POLYGON_TOLERANCE)
    result = first[:-1] + second[:-1]
    tolerance = COLLISION_POLYGON_TOLERANCE
    while len(result) > COLLISION_POLYGON_MAX_POINTS:
        tolerance *= 1.25
        first = simplify_open_path(points[: split + 1], tolerance)
        second = simplify_open_path(points[split:] + [points[0]], tolerance)
        result = first[:-1] + second[:-1]
        if tolerance > 8:
            stride = len(points) / COLLISION_POLYGON_MAX_POINTS
            result = [points[int(index * stride)] for index in range(COLLISION_POLYGON_MAX_POINTS)]
            break
    if len(result) < 3:
        result = [
            points[int(index * len(points) / COLLISION_POLYGON_MAX_POINTS)]
            for index in range(min(COLLISION_POLYGON_MAX_POINTS, len(points)))
        ]
    return result


def collision_polygon(binary_mask: np.ndarray) -> list[list[float]]:
    contour = trace_outer_contour(binary_mask)
    if len(contour) < 3:
        raise RuntimeError("Could not extract a polygon collision contour")
    points = simplify_closed_contour(contour)
    size = binary_mask.shape[0]
    return [[round(x / size, 5), round(y / size, 5)] for x, y in points]


def process(path: Path) -> dict[str, object]:
    image = Image.open(path).convert("RGBA")
    source_rgba = np.asarray(image, dtype=np.uint8)
    rgb = source_rgba[:, :, :3]
    source_alpha = source_rgba[:, :, 3].astype(np.float32)
    background = connected_background(rgb)
    background &= source_alpha > ALPHA_BOUNDS_THRESHOLD

    # Feather only the white edge pixels that were reached from outside.
    # Color decontamination reduces the pale fringe on dark water backgrounds.
    brightness_loss = 255.0 - rgb.astype(np.float32).min(axis=2)
    alpha = source_alpha.copy()
    feather = np.clip(
        (brightness_loss - ALPHA_FADE_START)
        / (ALPHA_FADE_END - ALPHA_FADE_START),
        0.0,
        1.0,
    ) * 255.0
    alpha[background] = np.minimum(alpha[background], feather[background])

    rgba = np.dstack((rgb.astype(np.float32), alpha))
    fractional = background & (alpha > 1.0) & (alpha < 254.0)
    if np.any(fractional):
        a = alpha[fractional, None] / 255.0
        rgba[fractional, :3] = np.clip(
            (rgba[fractional, :3] - (1.0 - a) * 255.0) / np.maximum(a, 0.04),
            0.0,
            255.0,
        )
    rgba[:, :, 3] = alpha
    cutout = Image.fromarray(np.clip(rgba, 0, 255).astype(np.uint8), "RGBA")

    mask = np.asarray(cutout.getchannel("A")) > ALPHA_BOUNDS_THRESHOLD
    ys, xs = np.where(mask)
    if len(xs) == 0:
        raise RuntimeError(f"No foreground remained after masking {path.name}")

    left, top = int(xs.min()), int(ys.min())
    right, bottom = int(xs.max()) + 1, int(ys.max()) + 1
    content = cutout.crop((left, top, right, bottom))
    scale = (OUTPUT_SIZE * CONTENT_FIT) / max(content.size)
    target = (max(1, round(content.width * scale)), max(1, round(content.height * scale)))
    content = content.resize(target, Image.Resampling.LANCZOS)

    output = Image.new("RGBA", (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    offset = ((OUTPUT_SIZE - target[0]) // 2, (OUTPUT_SIZE - target[1]) // 2)
    output.alpha_composite(content, offset)

    out_mask = np.asarray(output.getchannel("A")) > ALPHA_BOUNDS_THRESHOLD
    oy, ox = np.where(out_mask)
    out_left, out_top = int(ox.min()), int(oy.min())
    out_right, out_bottom = int(ox.max()) + 1, int(oy.max()) + 1
    box_width = out_right - out_left
    box_height = out_bottom - out_top
    center_x = (out_left + out_right) / 2.0
    center_y = (out_top + out_bottom) / 2.0
    tight_alpha = output.crop((out_left, out_top, out_right, out_bottom)).getchannel("A")
    mask_size = 128
    mask_image = tight_alpha.resize(
        (mask_size, mask_size),
        Image.Resampling.LANCZOS,
    )
    collision_mask = np.asarray(mask_image) >= COLLISION_ALPHA_THRESHOLD
    polygon = collision_polygon(collision_mask)

    output_path = OUTPUT_DIR / path.name
    output.save(output_path, optimize=True)

    return {
        "id": path.stem,
        "src": f"Assets/processed/{path.name}",
        "sourceSize": {"width": image.width, "height": image.height},
        "sourceForegroundBounds": {
            "x": left,
            "y": top,
            "width": right - left,
            "height": bottom - top,
        },
        "imageSize": {"width": OUTPUT_SIZE, "height": OUTPUT_SIZE},
        "alphaBounds": {
            "x": out_left,
            "y": out_top,
            "width": box_width,
            "height": box_height,
            "threshold": ALPHA_BOUNDS_THRESHOLD,
        },
        "collision": {
            "type": "polygon",
            "cx": round(center_x / OUTPUT_SIZE, 5),
            "cy": round(center_y / OUTPUT_SIZE, 5),
            "polygon": polygon,
            "bounds": {
                "x": round(out_left / OUTPUT_SIZE, 5),
                "y": round(out_top / OUTPUT_SIZE, 5),
                "width": round(box_width / OUTPUT_SIZE, 5),
                "height": round(box_height / OUTPUT_SIZE, 5),
            },
            "vertexCount": len(polygon),
            "note": "Irregular silhouette collider follows the alpha boundary with a simplified 32-vertex maximum polygon.",
        },
        "removedBackgroundPercent": round(float(background.mean() * 100.0), 2),
    }


def main() -> None:
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    sources = sorted(SOURCE_DIR.glob("*.png"), key=lambda p: p.name.lower())
    if not sources:
        raise SystemExit(f"No source PNGs found in {SOURCE_DIR}")

    entries = [process(path) for path in sources]
    manifest = {
        "version": 2,
        "progressionOrder": PROGRESSION_ORDER,
        "backgroundRemoval": {
            "method": "edge-connected near-white flood fill with a soft alpha fringe",
            "sourceFolder": "Assets/images",
            "outputFolder": "Assets/processed",
            "alphaBoundsThreshold": ALPHA_BOUNDS_THRESHOLD,
            "collisionPolygonMaxPoints": COLLISION_POLYGON_MAX_POINTS,
            "collisionPolygonTolerance": COLLISION_POLYGON_TOLERANCE,
            "collisionAlphaThreshold": COLLISION_ALPHA_THRESHOLD,
        },
        "assets": entries,
    }
    manifest_text = json.dumps(manifest, ensure_ascii=False, indent=2) + "\n"
    (OUTPUT_DIR / "manifest.json").write_text(manifest_text, encoding="utf-8")
    asset_script = (
        "window.FISH_ASSET_MANIFEST = "
        + json.dumps(manifest, ensure_ascii=False, separators=(",", ":"))
        + ";\n"
    )
    (OUTPUT_DIR / "manifest.js").write_text(asset_script, encoding="utf-8")
    print(f"Processed {len(entries)} images into {OUTPUT_DIR}")
    for item in entries:
        print(
            f"{item['id']}: bbox={item['alphaBounds']} "
            f"polygon={item['collision']['vertexCount']} vertices"
        )


if __name__ == "__main__":
    main()

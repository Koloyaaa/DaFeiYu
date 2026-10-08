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
from scipy.spatial import ConvexHull


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
COLLISION_POLYGON_MAX_POINTS = 20
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


def polygon_area(points: list[tuple[float, float]]) -> float:
    return sum(
        points[index][0] * points[(index + 1) % len(points)][1]
        - points[(index + 1) % len(points)][0] * points[index][1]
        for index in range(len(points))
    ) / 2.0


def collision_polygon(binary_mask: np.ndarray) -> list[list[float]]:
    """Build a low-vertex polygon that fully contains every visible mask pixel."""
    y_coords, x_coords = np.nonzero(binary_mask)
    if len(x_coords) < 3:
        raise RuntimeError("Could not extract a polygon collision contour")
    points = np.column_stack((x_coords, y_coords)).astype(np.float64)
    hull = ConvexHull(points)
    hull_points = points[hull.vertices]
    edges = np.roll(hull_points, -1, axis=0) - hull_points
    normals = np.column_stack((-edges[:, 1], edges[:, 0]))
    normals /= np.linalg.norm(normals, axis=1)[:, None]

    # Support each foreground pixel as a square, not a point. The extra half
    # pixel covers raster rounding after the normalized points are serialized.
    support = np.max(points @ normals.T, axis=0)
    support += 0.5 * (np.abs(normals[:, 0]) + np.abs(normals[:, 1])) + 0.5
    planes = [(normal, float(distance)) for normal, distance in zip(normals, support)]

    def intersections(active_planes: list[tuple[np.ndarray, float]]) -> list[tuple[float, float]] | None:
        vertices: list[tuple[float, float]] = []
        for index, (normal_a, distance_a) in enumerate(active_planes):
            normal_b, distance_b = active_planes[(index + 1) % len(active_planes)]
            matrix = np.stack((normal_a, normal_b))
            if abs(float(np.linalg.det(matrix))) < 1e-9:
                return None
            vertex = np.linalg.solve(matrix, np.array([distance_a, distance_b]))
            if any(float(np.dot(normal, vertex)) > distance + 1e-7 for normal, distance in active_planes):
                return None
            vertices.append((float(vertex[0]), float(vertex[1])))
        return vertices if len(vertices) >= 3 else None

    polygon = intersections(planes)
    if polygon is None:
        raise RuntimeError("Could not construct a containing collision polygon")

    # Remove the least influential support edge at each step. Unlike sampling
    # contour points, every reduced polygon still encloses the full alpha mask.
    while len(planes) > COLLISION_POLYGON_MAX_POINTS:
        current_area = abs(polygon_area(polygon))
        removal_costs: list[float] = []
        for index in range(len(planes)):
            candidate = intersections(planes[:index] + planes[index + 1 :])
            removal_costs.append(
                float("inf") if candidate is None else abs(polygon_area(candidate)) - current_area
            )
        remove_index = int(np.argmin(removal_costs))
        planes.pop(remove_index)
        polygon = intersections(planes)
        if polygon is None:
            raise RuntimeError("Could not simplify the containing collision polygon")

    # A final containment guard protects future edits to the simplifier.
    if any(
        np.any(points @ normal > distance + 1e-6)
        for normal, distance in planes
    ):
        raise RuntimeError("Collision polygon does not contain the alpha mask")

    size = binary_mask.shape[0]
    return [[round(x / size, 5), round(y / size, 5)] for x, y in polygon]


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
            "note": "Low-vertex convex polygon encloses the full alpha silhouette with a small rasterization margin.",
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


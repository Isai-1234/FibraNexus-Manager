"""Recorta el fondo blanco del arte nuevo y lo encaja en el mismo encuadre del arte actual.

Uso puntual: solo se corre a mano cuando se regenera el arte del visualizador de enlace.
"""
import sys
from collections import deque

import numpy as np
from PIL import Image

WHITE_TOL = 34          # distancia a blanco que cuenta como fondo
EDGE_SOFT_TOL = 90      # borde antialias: se le baja alpha para no dejar halo
SCALE = 3               # resolución final = original * SCALE


def content_bbox(path):
    im = Image.open(path).convert('RGBA')
    a = np.array(im)
    alpha = a[:, :, 3]
    if alpha.min() < 250:
        mask = alpha > 16
    else:
        mask = a[:, :, :3].min(axis=2) < (255 - WHITE_TOL)
    ys, xs = np.where(mask)
    return im.size, (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)


def drop_white_background(path):
    """Flood fill desde los bordes: conserva blancos interiores (bandas de la torre, cuerpo del plato)."""
    im = Image.open(path).convert('RGBA')
    rgb = np.array(im)[:, :, :3].astype(np.int16)
    h, w = rgb.shape[:2]
    dist = 255 - rgb.min(axis=2)          # 0 = blanco puro
    bg = np.zeros((h, w), dtype=bool)
    q = deque()

    for x in range(w):
        for y in (0, h - 1):
            if dist[y, x] <= WHITE_TOL and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))
    for y in range(h):
        for x in (0, w - 1):
            if dist[y, x] <= WHITE_TOL and not bg[y, x]:
                bg[y, x] = True
                q.append((y, x))

    while q:
        y, x = q.popleft()
        for ny, nx in ((y - 1, x), (y + 1, x), (y, x - 1), (y, x + 1)):
            if 0 <= ny < h and 0 <= nx < w and not bg[ny, nx] and dist[ny, nx] <= WHITE_TOL:
                bg[ny, nx] = True
                q.append((ny, nx))

    out = np.array(im)
    out[:, :, 3] = 255
    out[bg, 3] = 0

    # Suaviza el borde: pixeles casi blancos pegados al fondo quedan semitransparentes.
    pad = np.pad(bg, 1, constant_values=False)
    near_bg = (pad[:-2, 1:-1] | pad[2:, 1:-1] | pad[1:-1, :-2] | pad[1:-1, 2:]) & ~bg
    soft = near_bg & (dist < EDGE_SOFT_TOL)
    out[soft, 3] = np.clip(dist[soft] * 255 // EDGE_SOFT_TOL, 0, 255).astype(np.uint8)

    im2 = Image.fromarray(out)
    alpha = out[:, :, 3]
    ys, xs = np.where(alpha > 8)
    return im2.crop((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1))


def refit(new_path, reference_path, out_path):
    (rw, rh), (x0, y0, x1, y1) = content_bbox(reference_path)
    art = drop_white_background(new_path)

    canvas_w, canvas_h = rw * SCALE, rh * SCALE
    slot_w, slot_h = (x1 - x0) * SCALE, (y1 - y0) * SCALE
    scale = min(slot_w / art.width, slot_h / art.height)
    art = art.resize((max(1, round(art.width * scale)), max(1, round(art.height * scale))), Image.LANCZOS)

    canvas = Image.new('RGBA', (canvas_w, canvas_h), (0, 0, 0, 0))
    cx = x0 * SCALE + (slot_w - art.width) // 2
    cy = y0 * SCALE + (slot_h - art.height) // 2
    canvas.alpha_composite(art, (cx, cy))
    canvas.save(out_path)
    print(f'{out_path} <- {art.size} en lienzo {canvas.size} (ref {rw}x{rh} bbox {x0},{y0},{x1},{y1})')


if __name__ == '__main__':
    refit(*sys.argv[1:4])

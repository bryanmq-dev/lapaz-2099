"""Departamentos de Bolivia para el mapa de la guía (public/guia/bolivia.json).

Uso: python -I scripts/guia/bolivia.py <ne_10m_admin_1_states_provinces.geojson> [salida]
Fuente: Natural Earth 1:10m Admin-1 (dominio público).
De cada departamento se conserva el polígono exterior más grande, simplificado con Douglas-Peucker.
"""
import json
import math
import sys

TOL = 0.03  # grados (~3 km): suficiente para un mapa low-poly


def dp(pts, tol):
    """Douglas-Peucker iterativo sobre una lista de [lon, lat]."""
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[b]
        dx, dy = x2 - x1, y2 - y1
        n = math.hypot(dx, dy) or 1e-12
        far, idx = 0.0, -1
        for i in range(a + 1, b):
            d = abs(dy * (pts[i][0] - x1) - dx * (pts[i][1] - y1)) / n
            if d > far:
                far, idx = d, i
        if far > tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def area(ring):
    return abs(sum(x1 * y2 - x2 * y1 for (x1, y1), (x2, y2) in zip(ring, ring[1:] + ring[:1]))) / 2


def main(src, out):
    with open(src, encoding="utf-8") as f:
        feats = [x for x in json.load(f)["features"] if x["properties"].get("adm0_a3") == "BOL"]
    deps = []
    for ft in feats:
        g = ft["geometry"]
        polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
        ring = max((p[0] for p in polys), key=area)
        # el anillo cerrado repite el primer punto; dp necesita extremos distintos, así que se parte en dos mitades
        ring = ring[:-1]
        h = len(ring) // 2
        simple = dp(ring[: h + 1], TOL)[:-1] + dp(ring[h:] + ring[:1], TOL)[:-1]
        deps.append({"name": ft["properties"]["name"], "ring": [[round(x, 3), round(y, 3)] for x, y in simple]})
    deps.sort(key=lambda d: d["name"])
    with open(out, "w", encoding="utf-8") as f:
        json.dump({"source": "Natural Earth 1:10m Admin-1 (dominio público)", "departments": deps}, f, ensure_ascii=False, separators=(",", ":"))
    print(f"{len(deps)} departamentos, {sum(len(d['ring']) for d in deps)} vértices -> {out}")


if __name__ == "__main__":
    # ponytail: comprobación mínima de dp (una línea recta se reduce a sus extremos)
    assert dp([[0, 0], [1, 0.001], [2, 0]], 0.01) == [[0, 0], [2, 0]]
    main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "public/guia/bolivia.json")

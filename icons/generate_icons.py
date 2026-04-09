"""
generate_icons.py — Generate FocusLock PNG icons using only stdlib (no PIL).
Run once: python generate_icons.py
Produces: 16.png, 48.png, 128.png and states/ variants.
Requires: Pillow (pip install Pillow) for best results, OR falls back to
          writing minimal valid PNG files using raw bytes.
"""

import struct
import zlib
import os


def png_chunk(chunk_type, data):
    c = chunk_type + data
    return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xFFFFFFFF)


def make_png(size, colour_hex):
    """Create a solid-colour square PNG as bytes without external deps."""
    hex_c = colour_hex.lstrip('#')
    r, g, b = int(hex_c[0:2], 16), int(hex_c[2:4], 16), int(hex_c[4:6], 16)

    # Build raw image data: each row = filter_byte + RGBA pixels
    row = bytes([0]) + bytes([r, g, b, 255] * size)
    raw = row * size
    compressed = zlib.compress(raw, 9)

    png = b'\x89PNG\r\n\x1a\n'
    png += png_chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 2, 0, 0, 0))
    png += png_chunk(b'IDAT', compressed)
    png += png_chunk(b'IEND', b'')
    return png


COLOURS = {
    'default': '#0F766E',   # teal — "off" / base
    'deep_work': '#DC2626',
    'shallow_work': '#D97706',
    'break': '#16A34A',
    'off': '#6B7280',
    'cooldown': '#7C3AED',
}

SIZES = [16, 48, 128]

script_dir = os.path.dirname(os.path.abspath(__file__))
states_dir = os.path.join(script_dir, 'states')
os.makedirs(states_dir, exist_ok=True)

for size in SIZES:
    path = os.path.join(script_dir, f'{size}.png')
    with open(path, 'wb') as f:
        f.write(make_png(size, COLOURS['default']))
    print(f'  ✓ {size}.png')

for state, colour in COLOURS.items():
    for size in SIZES:
        path = os.path.join(states_dir, f'{state}_{size}.png')
        with open(path, 'wb') as f:
            f.write(make_png(size, colour))
    print(f'  ✓ states/{state}_*.png')

print('\nAll icons generated.')

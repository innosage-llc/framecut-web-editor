#!/usr/bin/env python3
"""#28 PR-C: frame-index fixtures for the camera/screen sync test.

Screen: 640x360, 30 fps, 10 s. Frame index as 9 bits, 40x40 black/white blocks at the top-left.
Camera: 320x240, 30 fps, 10 s. Frame index as 9 bits in a 3x3 grid of 40 px cells at the centre
(inside the default circle bubble after cover-fit). Both are VP8 WebM with a keyframe every
30 frames, like a recording. Run: python3 scripts/make-frame-index-fixtures.py
"""
import subprocess
import numpy as np

FPS, SECONDS, BITS = 30, 10, 9

def encode(path, w, h, draw):
    p = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{w}x{h}', '-r', str(FPS),
                          '-i', '-', '-c:v', 'libvpx', '-b:v', '1M', '-g', '30', '-deadline', 'good', path], stdin=subprocess.PIPE)
    for i in range(FPS * SECONDS):
        f = np.zeros((h, w, 3), np.uint8)
        draw(f, i)
        p.stdin.write(f.tobytes())
    p.stdin.close()
    assert p.wait() == 0

def screen(f, i):
    f[:] = (40, 60, 90)
    for b in range(BITS):
        f[20:60, 20 + b * 44:60 + b * 44] = 255 if (i >> b) & 1 else 0

def camera(f, i):
    f[:] = (200, 80, 40)
    for b in range(BITS):
        r, c = divmod(b, 3)
        y, x = 60 + r * 40, 100 + c * 40
        f[y:y + 40, x:x + 40] = 255 if (i >> b) & 1 else 0

encode('tests/fixtures/e2e-screen-frameindex-10s.webm', 640, 360, screen)
encode('tests/fixtures/e2e-camera-frameindex-10s.webm', 320, 240, camera)

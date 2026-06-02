"""Generate a true-color RGBA profile-hero.png from the source.

Same approach as the home-hero: 32-bit RGBA, no palette, binary-searched
to the largest size that stays under the 200KB image limit.
"""

import zlib
import struct

SRC = 'D:/AI/TallyRoom/设置页插画.png'
DST = 'D:/AI/TallyRoom/miniprogram/images/ui/profile-hero.png'
TARGET_BYTES = 200_000


def read_png(path):
    with open(path, 'rb') as f:
        data = f.read()
    if data[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG')
    i = 8
    chunks = []
    while i < len(data):
        length = struct.unpack('>I', data[i:i+4])[0]
        ctype = data[i+4:i+8]
        cdata = data[i+8:i+8+length]
        chunks.append((ctype, cdata))
        i += 8 + length + 4
    ihdr = chunks[0][1]
    w, h = struct.unpack('>II', ihdr[:8])
    bd, ct = ihdr[8], ihdr[9]
    if bd != 8 or ct not in (2, 6):
        raise ValueError('unsupported source PNG: bd=%d ct=%d' % (bd, ct))
    idat = b''.join(c[1] for c in chunks if c[0] == b'IDAT')
    raw = zlib.decompress(idat)
    bpp = 3 if ct == 2 else 4
    stride = w * bpp
    pixels = bytearray(w * h * bpp)
    prev = bytearray(stride)
    p = 0
    for y in range(h):
        filt = raw[p]; p += 1
        row = bytearray(raw[p:p+stride]); p += stride
        if filt == 1:
            for x in range(stride):
                row[x] = (row[x] + (row[x-bpp] if x >= bpp else 0)) & 0xff
        elif filt == 2:
            for x in range(stride):
                row[x] = (row[x] + prev[x]) & 0xff
        elif filt == 3:
            for x in range(stride):
                a = row[x-bpp] if x >= bpp else 0
                b = prev[x]
                row[x] = (row[x] + (a + b) // 2) & 0xff
        elif filt == 4:
            for x in range(stride):
                a = row[x-bpp] if x >= bpp else 0
                b = prev[x]
                c = prev[x-bpp] if x >= bpp else 0
                pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
                pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                row[x] = (row[x] + pred) & 0xff
        pixels[y*stride:(y+1)*stride] = row
        prev = row
    return w, h, bpp, pixels


def to_rgba(w, h, bpp, src):
    if bpp == 4:
        return bytearray(src)
    out = bytearray(w * h * 4)
    for i in range(w * h):
        out[i*4] = src[i*3]
        out[i*4+1] = src[i*3+1]
        out[i*4+2] = src[i*3+2]
        out[i*4+3] = 255
    return out


def resize_rgba(w, h, src, tw, th):
    out = bytearray(tw * th * 4)
    sx_ratio = w / tw
    sy_ratio = h / th
    for y in range(th):
        sy = (y + 0.5) * sy_ratio - 0.5
        sy0 = int(sy); sy1 = sy0 + 1; fy = sy - sy0
        if sy0 < 0: sy0 = 0
        if sy1 >= h: sy1 = h - 1
        for x in range(tw):
            sx = (x + 0.5) * sx_ratio - 0.5
            sx0 = int(sx); sx1 = sx0 + 1; fx = sx - sx0
            if sx0 < 0: sx0 = 0
            if sx1 >= w: sx1 = w - 1
            i00 = (sy0 * w + sx0) * 4
            i01 = (sy0 * w + sx1) * 4
            i10 = (sy1 * w + sx0) * 4
            i11 = (sy1 * w + sx1) * 4
            o = (y * tw + x) * 4
            for c in range(4):
                p00 = src[i00 + c]; p01 = src[i01 + c]
                p10 = src[i10 + c]; p11 = src[i11 + c]
                v = (p00 * (1-fx) + p01 * fx) * (1-fy) + (p10 * (1-fx) + p11 * fx) * fy
                out[o + c] = int(v + 0.5)
    return out


def filter_row(row, prev, bpp, stride, filt):
    out = bytearray(stride)
    if filt == 0:
        out[:] = row
    elif filt == 1:
        for x in range(stride):
            a = row[x-bpp] if x >= bpp else 0
            out[x] = (row[x] - a) & 0xff
    elif filt == 2:
        for x in range(stride):
            out[x] = (row[x] - prev[x]) & 0xff
    elif filt == 3:
        for x in range(stride):
            a = row[x-bpp] if x >= bpp else 0
            b = prev[x]
            out[x] = (row[x] - (a + b) // 2) & 0xff
    elif filt == 4:
        for x in range(stride):
            a = row[x-bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x-bpp] if x >= bpp else 0
            pa, pb, pc = abs(b-c), abs(a-c), abs(a+b-2*c)
            pred = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
            out[x] = (row[x] - pred) & 0xff
    return out


def write_png_rgba(path, w, h, px):
    stride = w * 4
    bpp = 4
    raw = bytearray()
    prev = bytearray(stride)
    for y in range(h):
        row = px[y*stride:(y+1)*stride]
        best_f = 0
        best_data = filter_row(row, prev, bpp, stride, 0)
        best_sum = sum(b if b < 128 else 256 - b for b in best_data)
        for f in (1, 2, 3, 4):
            d = filter_row(row, prev, bpp, stride, f)
            s = sum(b if b < 128 else 256 - b for b in d)
            if s < best_sum:
                best_sum = s; best_f = f; best_data = d
        raw.append(best_f)
        raw.extend(best_data)
        prev = row
    compressed = zlib.compress(bytes(raw), 9)
    out = bytearray()
    out.extend(b'\x89PNG\r\n\x1a\n')
    def chunk(t, d):
        c = zlib.crc32(t + d)
        return struct.pack('>I', len(d)) + t + d + struct.pack('>I', c)
    ihdr = struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0)
    out.extend(chunk(b'IHDR', ihdr))
    out.extend(chunk(b'IDAT', compressed))
    out.extend(chunk(b'IEND', b''))
    with open(path, 'wb') as f:
        f.write(out)
    return len(out)


def main():
    print('Reading source...')
    sw, sh, sbpp, src = read_png(SRC)
    print('  {}x{}, bpp={}'.format(sw, sh, sbpp))
    print('Converting to RGBA...')
    src_rgba = to_rgba(sw, sh, sbpp, src)
    aspect = sw / sh

    lo, hi = 360, 800
    best = None
    while lo <= hi:
        mid = (lo + hi) // 2
        tw = (mid // 8) * 8
        th = int(round(tw / aspect)) & ~1
        print('\nTrying {}x{}...'.format(tw, th))
        px = resize_rgba(sw, sh, src_rgba, tw, th)
        sz = write_png_rgba(DST, tw, th, px)
        print('  written {} bytes ({:.1f} KB)'.format(sz, sz / 1024))
        if sz <= TARGET_BYTES:
            best = (tw, th, sz)
            lo = mid + 8
        else:
            hi = mid - 8

    if best:
        tw, th, sz = best
        print('\nFinalizing best size {}x{} ({:.1f} KB)'.format(tw, th, sz / 1024))
        px = resize_rgba(sw, sh, src_rgba, tw, th)
        sz = write_png_rgba(DST, tw, th, px)
        print('Final file: {} bytes ({:.1f} KB)'.format(sz, sz / 1024))


if __name__ == '__main__':
    main()

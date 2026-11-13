#!/usr/bin/env python3
"""Regenerate A1 assets on macOS with Python stdlib + Swift/AppKit, without Flutter."""
import argparse
import json
import math
from pathlib import Path
import struct
import subprocess
import tempfile
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'assets'
SOURCE = ASSETS / 'branding'
RES = ROOT / 'android/app/src/main/res'
ANDROID = 'http://schemas.android.com/apk/res/android'
AAPT = 'http://schemas.android.com/aapt'
SVG = 'http://www.w3.org/2000/svg'
ET.register_namespace('android', ANDROID)
ET.register_namespace('aapt', AAPT)
LAUNCHER = 'ic_launcher_mc'
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def attrs(**values):
    return {f'{{{ANDROID}}}{key}': f'{value:g}' if isinstance(value, float) else str(value) for key, value in values.items()}


def write_xml(path, element):
    ET.indent(element, space='    ')
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(ET.tostring(element, encoding='utf-8', xml_declaration=True) + b'\n')


def shape_data(node):
    tag = node.tag.split('}')[-1]
    if tag == 'path':
        return node.attrib['d']
    if tag == 'circle':
        x, y, r = (float(node.attrib[key]) for key in ('cx', 'cy', 'r'))
        return f'M{x-r:g},{y:g} a{r:g},{r:g} 0 1,0 {2*r:g},0 a{r:g},{r:g} 0 1,0 {-2*r:g},0'
    if tag == 'rect':
        x, y, w, h = (float(node.attrib.get(key, 0)) for key in ('x', 'y', 'width', 'height'))
        assert float(node.attrib.get('rx', 0)) == 0, 'Adaptive background must be full bleed'
        return f'M{x:g},{y:g} h{w:g} v{h:g} h{-w:g} Z'
    raise ValueError(f'Unsupported SVG primitive: {tag}')


def vector(source):
    svg = ET.parse(source).getroot()
    x, y, width, height = map(float, svg.attrib['viewBox'].split())
    root = ET.Element('vector', attrs(width='108dp', height='108dp', viewportWidth=f'{width:g}', viewportHeight=f'{height:g}'))
    group = ET.SubElement(root, 'group', attrs(translateX=f'{-x:g}', translateY=f'{-y:g}'))
    for node in svg:
        if node.tag == f'{{{SVG}}}defs':
            continue
        path = ET.SubElement(group, 'path', attrs(pathData=shape_data(node)))
        for svg_key, android_key in [('stroke', 'strokeColor'), ('stroke-width', 'strokeWidth'), ('stroke-linecap', 'strokeLineCap'), ('stroke-linejoin', 'strokeLineJoin')]:
            if svg_key in node.attrib:
                path.set(f'{{{ANDROID}}}{android_key}', node.attrib[svg_key])
        fill = node.attrib.get('fill', '#000000')
        if not fill.startswith('url('):
            path.set(f'{{{ANDROID}}}fillColor', '#00000000' if fill == 'none' else fill)
            continue
        gradient = svg.find(f".//*[@id='{fill[5:-1]}']")
        assert gradient is not None
        radial = gradient.tag.endswith('radialGradient')
        prop = ET.SubElement(path, f'{{{AAPT}}}attr', {'name': 'android:fillColor'})
        if radial:
            values = dict(type='radial', centerX=x + float(gradient.attrib['cx']) * width,
                          centerY=y + float(gradient.attrib['cy']) * height,
                          gradientRadius=float(gradient.attrib['r']) * math.hypot(width, height) / math.sqrt(2))
        else:
            values = dict(type='linear', startX=x + float(gradient.attrib['x1']) * width,
                          startY=y + float(gradient.attrib['y1']) * height,
                          endX=x + float(gradient.attrib['x2']) * width,
                          endY=y + float(gradient.attrib['y2']) * height)
        paint = ET.SubElement(prop, 'gradient', attrs(**values))
        opacity = max(float(stop.attrib.get('stop-opacity', 1)) for stop in gradient)
        if opacity != 1:
            path.set(f'{{{ANDROID}}}fillAlpha', str(opacity))
        for stop in gradient:
            alpha = round(float(stop.attrib.get('stop-opacity', 1)) / opacity * 255)
            color = f'#{alpha:02X}' + stop.attrib['stop-color'].lstrip('#')
            ET.SubElement(paint, 'item', attrs(offset=stop.attrib['offset'], color=color))
    return root


def preview_svg(vector_root):
    """Project the actual VectorDrawable geometry/gradients into SVG for native preview."""
    get = lambda node, key, default=None: node.get(f'{{{ANDROID}}}{key}', default)
    root = ET.Element('svg', {'xmlns': SVG, 'viewBox': f"0 0 {get(vector_root, 'viewportWidth')} {get(vector_root, 'viewportHeight')}"})
    defs = ET.SubElement(root, 'defs')
    count = 0
    for vg in vector_root:
        group = ET.SubElement(root, 'g', {'transform': f"translate({get(vg, 'translateX', '0')} {get(vg, 'translateY', '0')})"})
        for vp in vg:
            path = ET.SubElement(group, 'path', {'d': get(vp, 'pathData')})
            for android_key, svg_key in [('strokeColor', 'stroke'), ('strokeWidth', 'stroke-width'), ('strokeLineCap', 'stroke-linecap'), ('strokeLineJoin', 'stroke-linejoin'), ('fillAlpha', 'fill-opacity')]:
                if get(vp, android_key) is not None:
                    path.set(svg_key, get(vp, android_key))
            gradient = vp.find(f'{{{AAPT}}}attr/gradient')
            if gradient is None:
                color = get(vp, 'fillColor', '#000000')
                path.set('fill', 'none' if color == '#00000000' else color)
                continue
            count += 1
            identifier = f'g{count}'
            if get(gradient, 'type') == 'radial':
                attributes = {'cx': get(gradient, 'centerX'), 'cy': get(gradient, 'centerY'), 'r': get(gradient, 'gradientRadius')}
                tag = 'radialGradient'
            else:
                attributes = {dest: get(gradient, src) for src, dest in [('startX', 'x1'), ('startY', 'y1'), ('endX', 'x2'), ('endY', 'y2')]}
                tag = 'linearGradient'
            sg = ET.SubElement(defs, tag, {**attributes, 'id': identifier, 'gradientUnits': 'userSpaceOnUse'})
            for stop in gradient:
                color = get(stop, 'color')
                ET.SubElement(sg, 'stop', {'offset': get(stop, 'offset'), 'stop-color': '#' + color[3:], 'stop-opacity': str(int(color[1:3], 16) / 255)})
            path.set('fill', f'url(#{identifier})')
    return root


def finalize_splash():
    for qualifier in ['drawable', 'drawable-v21', 'drawable-night', 'drawable-night-v21']:
        path = RES / qualifier / 'launch_background.xml'
        path.write_text(path.read_text().replace('@drawable/splash', '@drawable/android12splash'))


def notification_vector():
    # Only the M silhouette, centered in a 24dp canvas with transparent margins.
    source = ET.parse(SOURCE / 'A1-adaptive-monochrome.svg').getroot()
    mark = source.find(f'{{{SVG}}}path')
    root = ET.Element('vector', attrs(width='24dp', height='24dp', viewportWidth=512, viewportHeight=512))
    group = ET.SubElement(root, 'group', attrs(translateX=-256, translateY=-286))
    ET.SubElement(group, 'path', attrs(pathData=mark.attrib['d'], fillColor='#00000000',
                                     strokeColor='#FFFFFF', strokeWidth=mark.attrib['stroke-width'],
                                     strokeLineCap='round', strokeLineJoin='round'))
    return root


def generate(preview):
    jobs = []
    with tempfile.TemporaryDirectory(prefix='mobicodex-branding-') as temp:
        temp = Path(temp)
        def render(source, output, size):
            output.parent.mkdir(parents=True, exist_ok=True)
            jobs.append(dict(source=str(source), output=str(output), size=size))
        def mark(source, name):
            node = ET.parse(source).getroot()
            node.set('viewBox', '0 0 1024 1024')
            path = temp / name
            write_xml(path, node)
            return path
        icon = SOURCE / 'A1-icon.svg'
        light = SOURCE / 'A1-mark-light.svg'
        foreground = SOURCE / 'A1-adaptive-foreground.svg'
        dark = mark(foreground, 'dark.svg')
        mono = mark(SOURCE / 'A1-adaptive-monochrome.svg', 'mono.svg')
        round_icon = ET.parse(icon).getroot()
        for rectangle in round_icon.findall(f'{{{SVG}}}rect'):
            rectangle.set('rx', str(float(rectangle.attrib['width']) / 2))
        round_source = temp / 'round.svg'
        write_xml(round_source, round_icon)
        for name, source, size in [('app_icon.png', icon, 1254), ('app_icon_2.png', icon, 1254),
                                   ('app_icon_macos.png', icon, 1024), ('app_icon_macos2.png', icon, 1024),
                                   ('app_icon_foreground.png', foreground, 1024), ('start.png', light, 512),
                                   ('start_dark.png', dark, 512), ('icons/kelivo.png', icon, 512), ('icon_mac.png', mono, 512)]:
            render(source, ASSETS / name, size)
        for layer in ['background', 'foreground', 'monochrome']:
            drawable = RES / 'drawable' / f'brand_a1_{layer}.xml'
            write_xml(drawable, vector(SOURCE / f'A1-adaptive-{layer}.svg'))
            if preview:
                preview_source = preview / f'adaptive-{layer}.svg'
                write_xml(preview_source, preview_svg(ET.parse(drawable).getroot()))
                render(preview_source, preview / f'adaptive-{layer}.png', 512)
        notification = RES / 'drawable/ic_background_generation.xml'
        write_xml(notification, notification_vector())
        if preview:
            preview_source = preview / 'notification.svg'
            write_xml(preview_source, preview_svg(ET.parse(notification).getroot()))
            render(preview_source, preview / 'notification.png', 512)
        adaptive = ET.Element('adaptive-icon')
        for layer in ['background', 'foreground', 'monochrome']:
            ET.SubElement(adaptive, layer, attrs(drawable=f'@drawable/brand_a1_{layer}'))
        write_xml(RES / 'mipmap-anydpi-v26' / f'{LAUNCHER}.xml', adaptive)
        write_xml(RES / 'mipmap-anydpi-v26' / f'{LAUNCHER}_round.xml', adaptive)
        for density, scale in DENSITIES.items():
            render(icon, RES / f'mipmap-{density}' / f'{LAUNCHER}.png', int(48 * scale))
            render(round_source, RES / f'mipmap-{density}' / f'{LAUNCHER}_round.png', int(48 * scale))
            for mode, source in [('', light), ('-night', dark)]:
                for name in ['splash', 'android12splash']:
                    render(source, RES / f'drawable{mode}-{density}' / f'{name}.png', int(128 * scale))
        sizes = [16, 32, 48, 64, 128, 256]
        for size in sizes:
            render(icon, temp / f'ico-{size}.png', size)
        manifest = temp / 'jobs.json'
        manifest.write_text(json.dumps(jobs))
        subprocess.run(['swift', '-module-cache-path', str(temp / 'swift-cache'), str(ROOT / 'tool/render_brand_svg.swift'), str(manifest)], check=True)
        images = [(size, (temp / f'ico-{size}.png').read_bytes()) for size in sizes]
        data = struct.pack('<HHH', 0, 1, len(images))
        offset = 6 + 16 * len(images)
        for size, png in images:
            data += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(png), offset)
            offset += len(png)
        (ASSETS / 'app_icon.ico').write_bytes(data + b''.join(png for _, png in images))
        if preview:
            (preview / 'render-manifest.json').write_text(json.dumps(jobs, indent=2))
    finalize_splash()
    # Exact obsolete host resource names; never touch the separate remote app.
    for name in ['ic_launcher.xml', 'ic_launcher.png', 'ic_launcher_foreground.png', 'ic_launcher_monochrome.png']:
        for obsolete in RES.glob(f'*/{name}'):
            obsolete.unlink()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--preview-dir', type=Path)
    parser.add_argument('--finalize-android', action='store_true')
    arguments = parser.parse_args()
    if arguments.finalize_android:
        finalize_splash()
    else:
        generate(arguments.preview_dir.resolve() if arguments.preview_dir else None)

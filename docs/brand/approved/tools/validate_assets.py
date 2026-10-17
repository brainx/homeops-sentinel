"""Validate the inventory, vector portability, platform exports, and archive integrity."""
from pathlib import Path
import hashlib
import json
import xml.etree.ElementTree as ET
import zipfile
from PIL import Image

root = Path(__file__).resolve().parents[1]
manifest = json.loads((root / 'manifest.json').read_text())
for record in manifest['files']:
    file = root / record['path']
    assert hashlib.sha256(file.read_bytes()).hexdigest() == record['sha256'], record['path']
    if file.suffix == '.png':
        image = Image.open(file)
        assert image.size == (record['width'], record['height']), record['path']
for file in root.rglob('*.svg'):
    tree = ET.parse(file)
    if file.parent.name == 'logos':
        assert not tree.findall('.//{http://www.w3.org/2000/svg}mask'), file
        assert not tree.findall('.//{http://www.w3.org/2000/svg}text'), file
for name in ['app-icon-1024.png', 'app-icon-192.png', 'apple-touch-icon.png']:
    assert Image.open(root / 'icons' / name).convert('RGBA').getchannel('A').getextrema() == (255,255), name
for name in ['android-adaptive-foreground', 'android-monochrome', 'notification-white', 'splash-foreground']:
    assert Image.open(root / 'icons/mobile' / (name + '.png')).convert('RGBA').getchannel('A').getextrema() == (0,255), name
foreground = Image.open(root / 'icons/mobile/android-adaptive-foreground.png').convert('RGBA').getchannel('A')
pixels = foreground.load()
for y in range(1080):
    for x in range(1080):
        if pixels[x,y] > 1:
            assert (x-540)**2 + (y-540)**2 <= 330**2, 'Foreground exceeds the conservative 660px central safe circle.'
archive = root / f'homeops-sentinel-brand-kit-v{manifest["version"]}.zip'
with zipfile.ZipFile(archive) as bundle:
    assert bundle.testzip() is None
    assert not any(name.endswith('.zip') for name in bundle.namelist()), 'Nested archive'
print(f'{len(manifest["files"])} files verified: hashes, dimensions, SVGs, alpha, adaptive safe circle, ZIP.')

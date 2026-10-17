"""Create a versioned ZIP and SHA-256 inventory from this kit, excluding the ZIP itself."""
from pathlib import Path
import hashlib,json,zipfile
from PIL import Image
root=Path(__file__).resolve().parents[1]
archive=root/'homeops-sentinel-brand-kit-v1.1.zip'
items=[]
for f in sorted(root.rglob('*')):
 if not f.is_file() or (f.suffix=='.zip' or f.name=='manifest.json') or '__pycache__' in f.parts:continue
 record={'path':f.relative_to(root).as_posix(),'bytes':f.stat().st_size,'sha256':hashlib.sha256(f.read_bytes()).hexdigest()}
 if f.suffix=='.png':
  im=Image.open(f);record.update(width=im.width,height=im.height,mode=im.mode)
 items.append(record)
(root/'manifest.json').write_text(json.dumps({'brand':'HomeOps Sentinel','version':'1.1','approval_date':'2026-10-15','updated_date':'2026-10-16','files':items,'inventory_scope':'All kit files except this manifest and its enclosing ZIP.','font_source':'rsms/inter at 353b61b9f4430d5f420d56605a6e7993e0941470; SIL OFL 1.1 included.'},indent=2))
with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
 for f in sorted(root.rglob('*')):
  if f.is_file() and f.suffix!='.zip' and '__pycache__' not in f.parts:z.write(f,Path('homeops-sentinel-brand-kit-v1.1')/f.relative_to(root))
print(f'{len(items)} inventoried files; ZIP {archive.stat().st_size:,} bytes')

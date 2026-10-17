"""Build approved HomeOps vector assets. Run with fonttools + skia-pathops installed."""
from pathlib import Path
import re, json
import pathops
from fontTools.svgLib.path import parse_path
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

ROOT=Path(__file__).resolve().parents[1]
OUTER='M36 114Q36 100 47 91L112 39Q128 26 144 39L209 91Q220 100 220 114V192Q220 220 192 220H64Q36 220 36 192Z'
CUT='M172 104H104Q82 104 82 124V134Q82 145 94 152L144 182H92L42 232H66L94 204H148Q176 204 176 180Q176 167 164 160L116 132H150Z'
def fmt(s):return re.sub(r'-?\d+\.\d+',lambda m:format(float(m[0]),'.4f').rstrip('0').rstrip('.'),s)
def flatten():
 a,b=pathops.Path(),pathops.Path()
 parse_path(OUTER,a.getPen());parse_path(CUT,b.getPen())
 c=pathops.op(a,b,pathops.PathOp.DIFFERENCE)
 pen=SVGPathPen(None);c.draw(pen)
 return fmt(pen.getCommands())
MARK=flatten()
font=instantiateVariableFont(TTFont(ROOT/'fonts/InterVariable.ttf'),{'wght':550,'opsz':32},inplace=False)
glyphs=font.getGlyphSet();cmap=font.getBestCmap();units=font['head'].unitsPerEm

def lettering(text,x,y,size,tracking=-.02):
 pen=SVGPathPen(glyphs);pos=x;scale=size/units
 for ch in text:
  glyph=glyphs[cmap[ord(ch)]]
  glyph.draw(TransformPen(pen,(scale,0,0,-scale,pos,y)))
  pos+=glyph.width*scale+tracking*size
 return fmt(pen.getCommands()),pos-x

def doc(w,h,body,title):
 return f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" viewBox="0 0 {w} {h}" role="img" aria-labelledby="title"><title id="title">{title}</title>{body}</svg>'
def path(fill):return f'<path fill="{fill}" fill-rule="evenodd" d="{MARK}"/>'
def symbol(x,y,size,color):return f'<g transform="translate({x} {y}) scale({size/256})">{path(color)}</g>'
def write(folder,name,data):(ROOT/folder/name).write_text(data)
COLORS={'white':'#f8fafc','ink':'#090d16','cyan':'#38bdf8'}
for name,color in COLORS.items():
 write('logos',f'mark-{name}.svg',doc(256,256,path(color),'HomeOps Sentinel approved mark'))
 d,_=lettering('HomeOps Sentinel',184,101,58)
 write('logos',f'wordmark-horizontal-{name}.svg',doc(760,160,symbol(8,8,144,color)+f'<path fill="{color}" d="{d}"/>','HomeOps Sentinel horizontal wordmark'))
 d,_=lettering('Sentinel',184,92,68)
 label,_=lettering('HOMEOPS',188,128,14,.17)
 write('logos',f'wordmark-compact-{name}.svg',doc(500,160,symbol(8,8,144,color)+f'<path fill="{color}" d="{d}"/><path fill="{color}" d="{label}"/>','HomeOps Sentinel compact wordmark'))
 d,width=lettering('HomeOps Sentinel',0,0,43)
 write('logos',f'wordmark-stacked-{name}.svg',doc(600,400,symbol(188,24,224,color)+f'<path fill="{color}" transform="translate({(600-width)/2} 322)" d="{d}"/>','HomeOps Sentinel stacked wordmark'))
# Native source: opaque and square. Rounded preview is separate from platform exports.
bg='<defs><linearGradient id="surface" x2="1" y2="1"><stop stop-color="#182942"/><stop offset="1" stop-color="#090d16"/></linearGradient><linearGradient id="light" x2=".4" y2="1"><stop stop-color="#f8fafc"/><stop offset=".65" stop-color="#e0f2fe"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs>'
for name,rounded in [('app-icon',False),('app-icon-preview',True)]:
 body=bg+f'<rect width="1024" height="1024" rx="{224 if rounded else 0}" fill="url(#surface)"/>'
 if rounded:body+='<rect x="3" y="3" width="1018" height="1018" rx="221" stroke="#34445c" stroke-width="6" fill="none"/>'
 body+=symbol(128,112,768,'url(#light)')
 write('icons',name+'.svg',doc(1024,1024,body,'HomeOps Sentinel app icon'+(' presentation' if rounded else ' square source')))
write('icons','app-icon-maskable.svg',doc(512,512,'<rect width="512" height="512" fill="#090d16"/>'+symbol(96,86,320,'#f8fafc'),'HomeOps Sentinel maskable icon'))
write('icons','favicon.svg',doc(64,64,'<rect width="64" height="64" rx="13" fill="#090d16"/>'+symbol(0,-1,64,'#38bdf8'),'HomeOps Sentinel favicon'))
write('icons','safari-pinned-tab.svg',doc(256,256,path('#000'),'HomeOps Sentinel monochrome tab icon'))
# All text in share artwork and logo lockups is outlined for portable vector reproduction.
def text(txt,x,y,size,color,tracking=-.025):
 d,_=lettering(txt,x,y,size,tracking)
 return f'<path fill="{color}" d="{d}"/>'
def social(w,h,style):
 base=f'<rect width="{w}" height="{h}" fill="#090d16"/><path d="M0 {h-8}H{w}" stroke="#38bdf8" stroke-width="8"/>'
 if style=='square':
  base+=symbol(70,48,160,'#f8fafc')+text('HomeOps Sentinel',76,265,51,'#f8fafc')
  base+=text('Know what runs.',76,460,83,'#f8fafc')+text('Know what changes.',76,563,83,'#f8fafc')
  base+=text('Evidence-backed reliability',80,815,33,'#a4b1c5')+text('for Home Assistant.',80,865,33,'#a4b1c5')
 elif style=='banner':
  base+=symbol(330,50,256,'#f8fafc')+text('HomeOps Sentinel',620,157,59,'#f8fafc')+text('Know what runs. Know what changes.',624,223,29,'#a4b1c5')
 else:
  base+=symbol(45,35,112,'#f8fafc')+text('HomeOps Sentinel',177,111,33,'#f8fafc')
  base+=text('Know what runs.',63,290,69,'#f8fafc')+text('Know what changes.',63,378,69,'#f8fafc')
  base+=text('Evidence-backed reliability & governance',67,h-119,26,'#a4b1c5')+text('for Home Assistant.',67,h-76,26,'#a4b1c5')
 return doc(w,h,base,'HomeOps Sentinel brand artwork')
for name,w,h,style in [('open-graph',1200,630,'wide'),('social-square',1080,1080,'square'),('repository-cover',1280,640,'wide'),('linkedin-banner',1584,396,'banner')]:write('social',name+'.svg',social(w,h,style))
(ROOT/'geometry.json').write_text(json.dumps({'name':'HomeOps Sentinel','approved':'2026-10-15','viewBox':[0,0,256,256],'master_path':MARK,'color_roles':COLORS,'source':'Approved infrastructure identity, authored home/S swept geometry.','font':'Inter variable, weight 550, optical size 32; vector lettering outlined.'},indent=2))
# Platform-specific deliverables preserve the approved master geometry.
(ROOT/'icons/mobile').mkdir(exist_ok=True)
write('icons/mobile','android-adaptive-foreground.svg',doc(1080,1080,symbol(216,196,648,'#f8fafc'),'HomeOps Android adaptive foreground'))
write('icons/mobile','android-adaptive-background.svg',doc(1080,1080,'<rect width="1080" height="1080" fill="#090d16"/>','HomeOps Android adaptive background'))
write('icons/mobile','android-monochrome.svg',doc(1080,1080,symbol(216,196,648,'#000'),'HomeOps Android monochrome identity'))
write('icons/mobile','notification-white.svg',doc(96,96,symbol(0,-2,96,'#fff'),'HomeOps monochrome notification icon'))
write('icons/mobile','splash-foreground.svg',doc(512,512,symbol(64,56,384,'#f8fafc'),'HomeOps transparent splash identity'))
launch='<rect width="1170" height="2532" fill="#090d16"/>'+symbol(393,910,384,'#f8fafc')
d,width=lettering('HomeOps Sentinel',0,0,44)
launch+=f'<path transform="translate({(1170-width)/2} 1405)" fill="#f8fafc" d="{d}"/>'
write('icons/mobile','launch-preview.svg',doc(1170,2532,launch,'HomeOps portrait launch composition study'))
store='<rect width="1024" height="500" fill="#090d16"/>'+symbol(40,44,100,'#f8fafc')
store+=text('HomeOps Sentinel',160,114,32,'#f8fafc')+text('Know what runs.',54,260,61,'#f8fafc')+text('Know what changes.',54,338,61,'#f8fafc')+text('Evidence-backed reliability for Home Assistant.',58,437,24,'#a4b1c5')
write('social','play-store-feature.svg',doc(1024,500,store,'HomeOps feature artwork'))
print('Vector kit built:',len(list(ROOT.rglob('*.svg'))),'SVGs')

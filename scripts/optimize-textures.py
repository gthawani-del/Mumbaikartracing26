"""Repack embedded GLB images for web delivery without changing geometry or UVs."""
import io,json,struct,sys
from pathlib import Path
from PIL import Image
src,dst=sys.argv[1:3]
data=Path(src).read_bytes();size=struct.unpack_from('<I',data,12)[0]
g=json.loads(data[20:20+size]);binary=data[28+size:];images={im['bufferView']:im for im in g.get('images',[]) if 'bufferView' in im};out=bytearray()
for i,v in enumerate(g['bufferViews']):
    chunk=binary[v.get('byteOffset',0):v.get('byteOffset',0)+v['byteLength']]
    if i in images:
        im=Image.open(io.BytesIO(chunk));im.thumbnail((1024,1024),Image.Resampling.LANCZOS);buf=io.BytesIO()
        if im.mode=='RGBA' and im.getextrema()[3][0]<255:
            im.save(buf,format='PNG',optimize=True);images[i]['mimeType']='image/png'
        else:
            im.convert('RGB').save(buf,format='JPEG',quality=88,optimize=True);images[i]['mimeType']='image/jpeg'
        chunk=buf.getvalue()
    out.extend(b'\0'*((-len(out))%4));v['byteOffset']=len(out);v['byteLength']=len(chunk);out.extend(chunk)
out.extend(b'\0'*((-len(out))%4));g['buffers'][0]['byteLength']=len(out)
j=json.dumps(g,separators=(',',':')).encode();j+=b' '*((-len(j))%4)
result=struct.pack('<III',0x46546c67,2,28+len(j)+len(out))+struct.pack('<II',len(j),0x4e4f534a)+j+struct.pack('<II',len(out),0x004e4942)+out
Path(dst).write_bytes(result)
faces=sum(g['accessors'][p['indices']]['count']//3 for m in g.get('meshes',[]) for p in m['primitives'] if 'indices' in p)
print(f'{Path(dst).name}: {len(data)/1e6:.1f} MB -> {len(result)/1e6:.2f} MB, {faces:,} triangles')

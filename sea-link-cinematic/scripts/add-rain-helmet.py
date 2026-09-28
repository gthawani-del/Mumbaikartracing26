"""Run in 3D Jutsu after build-hero-kart.py; keeps helmet independently switchable."""
import bpy, math
from mathutils import Vector
head=bpy.data.objects['DriverHead']
parts=[o for o in head.children if o.type=='MESH' and ('skin' in o.name or 'hair' in o.name.lower())]
bpy.context.view_layer.update()
points=[o.matrix_world @ Vector(v) for o in parts for v in o.bound_box]
lo=Vector([min(p[i] for p in points) for i in range(3)])
hi=Vector([max(p[i] for p in points) for i in range(3)])
center=(lo+hi)*.5
center.z += .035
radii=(hi-lo)*.5+Vector((.027,.03,.045))
helmet=bpy.data.objects.new('RainHelmet',None);bpy.context.scene.collection.objects.link(helmet)
helmet.parent=head;helmet.matrix_world.translation=center
shell=bpy.data.materials.new('Helmet ivory shell');shell.diffuse_color=(.82,.78,.65,1);shell.use_nodes=True
shell.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.82,.78,.65,1)
shell.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.25
visor=bpy.data.materials.new('Helmet smoked visor');visor.diffuse_color=(.025,.055,.07,1);visor.use_nodes=True
visor.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value=(.025,.055,.07,1)
visor.node_tree.nodes['Principled BSDF'].inputs['Metallic'].default_value=.65
visor.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value=.18
verts=[];faces=[]
for row in range(17):
    theta=.01+(math.pi-.02)*row/16
    for col in range(33):
        phi=2*math.pi*col/32
        verts.append((radii.x*math.sin(theta)*math.cos(phi),radii.y*math.sin(theta)*math.sin(phi),radii.z*math.cos(theta)))
for row in range(16):
    for col in range(32):
        a=row*33+col;faces.append((a,a+1,a+34,a+33))
mesh=bpy.data.meshes.new('Helmet shell mesh');mesh.from_pydata(verts,[],faces);mesh.materials.append(shell);mesh.materials.append(visor)
obj=bpy.data.objects.new('Helmet shell and visor',mesh);bpy.context.scene.collection.objects.link(obj);obj.parent=helmet
for poly in mesh.polygons:
    poly.use_smooth=True
    row=poly.index//32;col=poly.index%32
    if 6<=row<=9 and 18<=col<=29:poly.material_index=1
bpy.context.view_layer.update()
result={'helmetCenter':list(center),'dimensions':list(radii*2),'parent':helmet.parent.name}

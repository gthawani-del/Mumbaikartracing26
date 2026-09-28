"""Editable Sea Link hero kart source. Run in the approved 3D Jutsu Blender project.
Metres; Blender Z up, forward -Y. KartRoot is the portable game asset.
"""
import bpy, math
from mathutils import Vector

for obj in list(bpy.data.objects):
    bpy.data.objects.remove(obj, do_unlink=True)
for m in list(bpy.data.materials):
    bpy.data.materials.remove(m)
root = bpy.data.objects.new('KartRoot', None)
bpy.context.scene.collection.objects.link(root)

def material(name, color, rough=.5, metal=0, emission=0):
    m = bpy.data.materials.new(name); m.diffuse_color = (*color, 1); m.use_nodes = True
    p = m.node_tree.nodes.get('Principled BSDF')
    p.inputs['Base Color'].default_value = (*color, 1)
    p.inputs['Roughness'].default_value = rough; p.inputs['Metallic'].default_value = metal
    if emission:
        p.inputs['Emission Color'].default_value = (*color, 1); p.inputs['Emission Strength'].default_value = emission
    return m
paint = material('Crimson paint', (.38,.016,.035), .23,.35)
cream = material('Fairing highlight', (.66,.61,.46), .28,.4)
steel = material('Tubular black steel', (.035,.044,.05), .32,.72)
alloy = material('Brushed alloy', (.43,.47,.5), .25,.83)
rubber = material('Rubber tire', (.018,.021,.026), .73)
cloth = material('Driver navy cloth', (.035,.05,.073), .87)
seam = material('Cloth raised seams', (.062,.082,.11), .92)
skin = material('Adult skin', (.48,.265,.15), .64)
hair = material('Textured black hair', (.018,.013,.011), .76)
hairlight = material('Hair relief', (.032,.024,.018), .8)
seat = material('Bucket seat', (.025,.029,.032), .65)
red = material('Red LED', (.8,.007,.012), .22,.15, 1.6)
gold = material('Amber registration plate', (.88,.45,.06), .38,.15)
ink = material('Lettering dark', (.016,.018,.023), .8)
white = material('Jersey lettering', (.78,.77,.69), .85)

def finish(obj, name, mat, parent=root):
    obj.name = name; obj.data.materials.append(mat); obj.parent = parent
    if obj.type == 'MESH':
        for p in obj.data.polygons: p.use_smooth = True
    return obj

def box(name, loc, dims, mat, bevel=.035):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    obj=bpy.context.object; obj.dimensions=dims
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod=obj.modifiers.new('Rounded manufactured edge','BEVEL'); mod.width=bevel; mod.segments=3
        obj.modifiers.new('Face normals','WEIGHTED_NORMAL')
    return finish(obj,name,mat)

def ellipsoid(name,loc,dims,mat):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=24,ring_count=12,radius=1,location=loc)
    obj=bpy.context.object; obj.scale=tuple(v/2 for v in dims)
    return finish(obj,name,mat)

def tube(name,points,radius,mat):
    data=bpy.data.curves.new(name,'CURVE'); data.dimensions='3D';data.resolution_u=1
    data.bevel_depth=radius;data.bevel_resolution=2;data.resolution_u=2
    s=data.splines.new('POLY');s.points.add(len(points)-1)
    for p,co in zip(s.points,points):p.co=(*co,1)
    obj=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(obj)
    return finish(obj,name,mat)

def link(name,a,b,r1,r2,mat):
    a,b=Vector(a),Vector(b)
    bpy.ops.mesh.primitive_cone_add(vertices=20,radius1=r1,radius2=r2,depth=(b-a).length,location=(a+b)/2)
    obj=bpy.context.object;obj.rotation_euler=(b-a).to_track_quat('Z','Y').to_euler()
    return finish(obj,name,mat)

def rings(name,profiles,mat,n=32):
    verts=[];faces=[]
    for z,rx,ry,cy in profiles:
        for i in range(n):
            a=2*math.pi*i/n
            verts.append((rx*math.cos(a),cy+ry*math.sin(a),z))
    for j in range(len(profiles)-1):
        for i in range(n):
            a=j*n+i;b=j*n+(i+1)%n;faces.append((a,b,b+n,a+n))
    faces.append(tuple(reversed(range(n))));faces.append(tuple((len(profiles)-1)*n+i for i in range(n)))
    mesh=bpy.data.meshes.new(name);mesh.from_pydata(verts,[],faces);mesh.update()
    obj=bpy.data.objects.new(name,mesh);bpy.context.scene.collection.objects.link(obj)
    return finish(obj,name,mat)

def lettering(name,text,loc,size,mat):
    data=bpy.data.curves.new(name,'FONT');data.body=text;data.align_x='CENTER';data.align_y='CENTER'
    data.size=size;data.space_line=.88;data.extrude=.0008;data.resolution_u=3
    obj=bpy.data.objects.new(name,data);bpy.context.scene.collection.objects.link(obj)
    obj.location=loc;obj.rotation_euler=(math.pi/2,0,math.pi)
    return finish(obj,name,mat)

# Frame, low fairings and a seat that leaves the driver's upper back visible.
box('Floor tray',(0,-.06,.27),(1.16,1.9,.075),steel,.025)
for side in [-1,1]:
    tube('Chassis perimeter',[(side*.62,-1.04,.3),(side*.7,-.6,.29),(side*.68,.83,.3),(side*.55,1.14,.4)],.036,steel)
    box('Side fairing',(side*.56,.02,.43),(.25,1.3,.23),paint,.095)
    tube('Cream fairing edge',[(side*.6,-.6,.53),(side*.61,.47,.54)],.018,cream)
    tube('Seat support',[(side*.28,.6,.4),(side*.32,.44,.92),(side*.27,.22,1.01)],.029,steel)
box('Nose fairing',(0,-1.02,.41),(.77,.48,.23),paint,.105)
box('Front number stripe',(0,-1.06,.535),(.17,.37,.012),cream,.004)
box('Seat cushion',(0,.22,.57),(.63,.61,.17),seat,.085)
back=box('Low sculpted seat back',(0,.45,.79),(.68,.13,.51),seat,.065);back.rotation_euler.x=-.13
tube('Seat upper rim',[(-.32,.43,1.0),(-.23,.47,1.06),(.23,.47,1.06),(.32,.43,1.0)],.027,alloy)

# Broad tyres with rounded shoulders, grooves and working wheel pivots.
for rear in [False,True]:
    for side in [-1,1]:
        x=side*(.83 if rear else .75);y=.77 if rear else -.82;r=.35 if rear else .3;w=.37 if rear else .25
        pivot=bpy.data.objects.new(('WheelRear' if rear else 'WheelFront')+('L' if side<0 else 'R'),None)
        bpy.context.scene.collection.objects.link(pivot);pivot.parent=root;pivot.location=(x,y,r)
        # Revolved tyre section along X, so its silhouette has rounded shoulders.
        verts=[];faces=[];profile=[(-w/2,.23),(-w/2+.025,r-.018),(-w/2+.065,r),(w/2-.065,r),(w/2-.025,r-.018),(w/2,.23)]
        for dx,rr in profile:
            for i in range(40):
                a=2*math.pi*i/40;verts.append((dx,rr*math.cos(a),rr*math.sin(a)))
        for j in range(len(profile)-1):
            for i in range(40):
                k=j*40+i;l=j*40+(i+1)%40;faces.append((k,l,l+40,k+40))
        mesh=bpy.data.meshes.new('Rounded tread');mesh.from_pydata(verts,[],faces);mesh.update()
        obj=bpy.data.objects.new('Performance slick tyre',mesh);bpy.context.scene.collection.objects.link(obj);finish(obj,obj.name,rubber,pivot)
        bpy.ops.mesh.primitive_cylinder_add(vertices=24,radius=.165,depth=w+.01,rotation=(0,math.pi/2,0))
        hub=finish(bpy.context.object,'Wheel alloy hub',alloy,pivot)
        for groove in [-.085,0,.085] if rear else [-.055,.055]:
            bpy.ops.mesh.primitive_torus_add(major_segments=40,minor_segments=6,major_radius=r+.0008,minor_radius=.0035,location=(groove,0,0),rotation=(0,math.pi/2,0))
            finish(bpy.context.object,'Tread groove',steel,pivot)
        bpy.ops.mesh.primitive_cylinder_add(vertices=20,radius=.065,depth=.027,location=(side*(w/2+.018),0,0),rotation=(0,math.pi/2,0))
        finish(bpy.context.object,'Hub axle cap',steel,pivot)

# Exposed rear mechanical assembly.
link('Rear axle',(-.89,.77,.35),(.89,.77,.35),.035,.035,alloy)
box('Engine block',(.32,.82,.55),(.39,.42,.33),steel,.025)
for i in range(6):box('Engine cooling fin',(.32,.83,.43+i*.046),(.43,.43,.013),alloy,.005)
tube('Exhaust header',[(.48,.67,.58),(.68,.8,.5),(.65,1.1,.43),(.35,1.19,.45)],.033,alloy)
link('Exhaust silencer',(-.38,.9,.46),(-.38,1.28,.46),.08,.08,alloy)
link('Exhaust dark outlet',(-.38,1.275,.46),(-.38,1.3,.46),.056,.056,ink)
for side in [-1,1]:
    a=Vector((side*.61,.7,.35));b=Vector((side*.49,.53,.77))
    link('Suspension damper',a,b,.026,.026,alloy)
    axis=(b-a).normalized();u=axis.cross(Vector((0,1,0))).normalized();v=axis.cross(u)
    coil=[]
    for i in range(81):
        t=i/80;co=a.lerp(b,t)+.055*(u*math.cos(t*math.pi*14)+v*math.sin(t*math.pi*14));coil.append(tuple(co))
    tube('Coil spring',coil,.009,cream)
    box('Rear fairing',(side*.54,.9,.49),(.24,.4,.17),paint,.065)
    box('Rear lamp housing',(side*.53,1.125,.55),(.2,.085,.18),steel,.035)
    box('Red tail lamp',(side*.53,1.174,.55),(.14,.02,.12),red,.026)
    for i in range(3):tube('Lamp lens rib',[(side*.53-.053,1.187,.515+i*.033),(side*.53+.053,1.187,.515+i*.033)],.004,red)
tube('Rear protection hoop',[(-.78,.93,.25),(-.78,1.24,.26),(-.62,1.32,.28),(.62,1.32,.28),(.78,1.24,.26),(.78,.93,.25)],.032,steel)
box('Rear plate bracket',(0,1.16,.51),(.55,.055,.3),alloy,.025)
box('Registration plate',(0,1.194,.51),(.5,.017,.255),gold,.012)
lettering('Registration lettering','MUMBAI\nRACER',(0,1.205,.51),.102,ink)

# Adult male seated anatomy: tapered trunk, shaped jaw, exposed forearms, bent legs.
box('Driver pelvis',(0,.15,.72),(.51,.44,.24),cloth,.095)
torso=rings('Driver fitted shirt',[(.73,.24,.15,.17),(.85,.27,.165,.13),(1.02,.31,.18,.07),(1.18,.365,.17,0),(1.29,.34,.135,-.035),(1.36,.23,.11,-.045),(1.39,.115,.075,-.04)],cloth)
mod=torso.modifiers.new('Natural torso contours','SUBSURF');mod.levels=1;mod.render_levels=1
link('Driver neck',(0,-.055,1.32),(0,-.08,1.45),.092,.085,skin)
head=rings('Adult head',[(1.45,.08,.085,-.12),(1.49,.115,.115,-.1),(1.56,.145,.145,-.075),(1.66,.15,.155,-.06),(1.74,.14,.145,-.045),(1.79,.10,.105,-.035),(1.81,.025,.025,-.03)],skin)
mod=head.modifiers.new('Face contour smooth','SUBSURF');mod.levels=1;mod.render_levels=1
for side in [-1,1]:
    ellipsoid('Ear',(side*.148,-.047,1.625),(.048,.052,.093),skin)
    sleeve=ellipsoid('Short shirt sleeve',(side*.325,-.028,1.17),(.21,.235,.29),cloth);sleeve.rotation_euler.y=side*.25
    shoulder=(side*.37,-.07,1.20);elbow=(side*.46,-.29,.96);wrist=(side*.23,-.60,1.0)
    link('Upper arm',shoulder,elbow,.088,.073,skin);ellipsoid('Elbow',elbow,(.145,.14,.145),skin)
    link('Forearm',elbow,wrist,.075,.051,skin);ellipsoid('Hand on wheel',wrist,(.1,.12,.13),skin)
    link('Bent trouser thigh',(side*.17,.17,.69),(side*.23,-.45,.57),.145,.115,cloth)
    link('Trouser shin',(side*.23,-.45,.57),(side*.26,-.82,.32),.108,.07,cloth)
    box('Racing shoe',(side*.26,-.89,.32),(.18,.31,.12),seat,.05)
    tube('Shoulder sewn seam',[(side*.13,.065,1.345),(side*.28,.1,1.285),(side*.37,.055,1.19)],.007,seam)
    tube('Shirt waist fold',[(side*.025,.3,.81),(side*.17,.27,.85),(side*.25,.235,.87)],.006,seam)
ellipsoid('Nose',(0,-.217,1.61),(.067,.085,.115),skin)
link('Steering column',(0,-.72,.4),(0,-.59,.95),.021,.021,steel)
# Tilted wheel connects the hands and column.
wheel=[(.245*math.cos(i*math.pi/24),-.60+.075*math.sin(i*math.pi/24),1.0+.15*math.sin(i*math.pi/24)) for i in range(49)]
tube('Steering rim',wheel,.022,seat)
for side in [-1,1]:tube('Steering spoke',[(0,-.60,1.0),(side*.22,-.60,1.0)],.012,alloy)

# Sculpted hair cap with short directional clumps, avoiding a helmet silhouette.
haircap=rings('Short tapered hair',[(1.59,.135,.118,-.025),(1.65,.153,.155,-.038),(1.73,.153,.157,-.04),(1.8,.135,.13,-.02),(1.845,.08,.075,-.005),(1.86,.01,.01,0)],hair)
for i in range(24):
    theta=2*math.pi*i/24
    strand=[((rx+.001)*math.cos(theta),cy+(ry+.001)*math.sin(theta),z) for z,rx,ry,cy in [(1.65,.153,.155,-.038),(1.73,.153,.157,-.04),(1.8,.135,.13,-.02),(1.845,.08,.075,-.005)]]
    tube('Swept hair relief',strand,.0025,hairlight)
for obj in list(root.children):
    if obj.name.startswith(('Adult head','Ear','Short tapered hair','Swept hair relief','Nose')):
        obj.location.z -= .055
lettering('Driver back identity','MUMBAI\nNEVER\nSTOPS.',(0,.247,1.17),.088,white)

# Blend shirt and sleeves into a continuous cloth silhouette.
bpy.ops.object.select_all(action='DESELECT')
shirt_parts=[o for o in root.children if o.name.startswith(('Driver fitted shirt','Short shirt sleeve'))]
for o in shirt_parts:o.select_set(True)
bpy.context.view_layer.objects.active=shirt_parts[0]
bpy.ops.object.convert(target='MESH');bpy.ops.object.join()
shirt=bpy.context.object;shirt.name='Adult fitted shirt'
m=shirt.modifiers.new('Continuous cloth','REMESH');m.mode='VOXEL';m.voxel_size=.017;m.use_smooth_shade=True
bpy.ops.object.modifier_apply(modifier=m.name)
m=shirt.modifiers.new('Smooth cloth','SMOOTH');m.factor=1;m.iterations=4;bpy.ops.object.modifier_apply(modifier=m.name)
m=shirt.modifiers.new('Cloth game mesh','DECIMATE');m.ratio=.5;bpy.ops.object.modifier_apply(modifier=m.name)

# Batch fixed parts by material, retaining four independent wheel pivots.
bpy.ops.object.select_all(action='DESELECT')
for o in root.children_recursive:
    if o.type in {'MESH','CURVE','FONT'}:o.select_set(True)
bpy.context.view_layer.objects.active=shirt;bpy.ops.object.convert(target='MESH')
# Fit the back lettering to the curved shirt instead of floating behind it.
label=bpy.data.objects.get('Driver back identity')
profiles=[(.73,.24,.15,.17),(.85,.27,.165,.13),(1.02,.31,.18,.07),(1.18,.365,.17,0),(1.29,.34,.135,-.035),(1.36,.23,.11,-.045),(1.39,.115,.075,-.04)]
if label:
    inv=label.matrix_world.inverted()
    for vertex in label.data.vertices:
        point=label.matrix_world @ vertex.co
        for lower,upper in zip(profiles,profiles[1:]):
            if lower[0]<=point.z<=upper[0]:
                t=(point.z-lower[0])/(upper[0]-lower[0])
                rx,ry,cy=[lower[k]+(upper[k]-lower[k])*t for k in (1,2,3)]
                point.y=cy+ry*math.sqrt(max(0,1-(point.x/rx)**2))+.009
                vertex.co=inv @ point
                break
# Preserve semantic pivots for restrained runtime driver animation.
def pivot(name, loc, parent):
    p=bpy.data.objects.new(name,None);bpy.context.scene.collection.objects.link(p);p.parent=parent;p.location=loc
    bpy.context.view_layer.update();return p
def reparent(o,p):
    world=o.matrix_world.copy();o.parent=p;o.matrix_world=world
body=pivot('DriverTorso',(0,.1,.78),root)
headpivot=pivot('DriverHead',(0,-.16,.61),body)
hands=pivot('DriverHands',(0,-.7,.22),body)
for o in list(root.children):
    if o.type!='MESH':continue
    if o.name.startswith(('Adult head','Ear','Short tapered hair','Swept hair relief','Nose')):reparent(o,headpivot)
    elif o.name.startswith(('Forearm','Hand on wheel','Steering rim','Steering spoke')):reparent(o,hands)
    elif o.name.startswith(('Adult fitted shirt','Driver neck','Upper arm','Elbow','Shoulder sewn seam','Shirt waist fold','Driver back identity')):reparent(o,body)
for parent in [root,body,headpivot,hands]+[o for o in root.children if o.name.startswith('Wheel')]:
    groups={}
    for o in list(parent.children):
        if o.type=='MESH':groups.setdefault(o.data.materials[0].name,[]).append(o)
    for name,objects in groups.items():
        bpy.ops.object.select_all(action='DESELECT')
        for o in objects:o.select_set(True)
        bpy.context.view_layer.objects.active=objects[0]
        if len(objects)>1:bpy.ops.object.join()
        bpy.context.object.name=parent.name+' '+name

# Modular toll plaza, separate portable root. Booths stay outside racing lanes.
toll=bpy.data.objects.new('TollPlazaRoot',None);bpy.context.scene.collection.objects.link(toll)
concrete=material('Toll concrete',(.42,.45,.43),.85)
green=material('Toll canopy green',(.025,.16,.12),.38,.25)
glass=material('Toll booth glass',(.06,.17,.20),.2,.3)
lamp=material('Toll lane light',(.3,.9,.5),.4,0,2)
def tbox(name,loc,dims,mat,bevel=.05):
    o=box(name,loc,dims,mat,bevel);o.parent=toll;return o
for side in [-1,1]:
    tbox('Toll island',(side*9,-12,.18),(3,10,.36),concrete)
    tbox('Toll booth',(side*9,-12,1.7),(2,3.6,3),green)
    tbox('Booth window',(side*9,-10.18,2),(1.6,.035,1.35),glass,.01)
    for y in [-15,-9]:tbox('Canopy support',(side*11,y,3.85),(.45,.45,7.7),alloy)
tbox('Canopy roof',(0,-12,7.8),(25,8,.5),green)
tbox('Canopy front fascia',(0,-7.97,7.45),(25,.12,.7),white)
for x in [-4.2,0,4.2]:tbox('Open lane indicator',(x,-7.85,7.4),(.55,.08,.25),lamp,.03)
# Batch each plaza material; retain a clean external asset root.
for matname in set(o.data.materials[0].name for o in toll.children if o.type=='MESH'):
    objects=[o for o in toll.children if o.type=='MESH' and o.data.materials[0].name==matname]
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:o.select_set(True)
    bpy.context.view_layer.objects.active=objects[0];bpy.ops.object.convert(target='MESH')
    if len(objects)>1:bpy.ops.object.join()
    bpy.context.object.name='Plaza '+matname
toll.location.x=25

# Presentation rig is outside KartRoot and is excluded by the game loader.
bpy.ops.object.camera_add(location=(3.5,5.5,3.0))
camera=bpy.context.object;camera.name='Delivery camera';camera.rotation_euler=(Vector((0,0,.85))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.type='ORTHO';camera.data.ortho_scale=3.8;bpy.context.scene.camera=camera
for name,loc,power,size in [('Key',(-3,3,5),1100,4),('Fill',(4,1,3),800,3),('Rim',(0,-4,4),1300,3)]:
    bpy.ops.object.light_add(type='AREA',location=loc);obj=bpy.context.object;obj.name=name;obj.data.energy=power;obj.data.shape='DISK';obj.data.size=size;obj.rotation_euler=(Vector((0,0,.8))-obj.location).to_track_quat('-Z','Y').to_euler()
scene=bpy.context.scene;scene.render.engine='BLENDER_EEVEE';scene.render.resolution_x=800;scene.render.resolution_y=800;scene.render.resolution_percentage=100
scene.world.color=(.15,.15,.15);scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.media_type='IMAGE'
preview=artifacts.file(name='hero-kart-rear.png',media_type='image/png');scene.render.filepath=preview.path;bpy.ops.render.render(write_still=True);preview.publish()
result={'asset':'KartRoot','wheelPivots':['WheelFrontL','WheelFrontR','WheelRearL','WheelRearR'],'objects':len(root.children)}

camera.location=(42,20,22);camera.rotation_euler=(Vector((25,-12,3))-camera.location).to_track_quat('-Z','Y').to_euler();camera.data.ortho_scale=38
preview=artifacts.file(name='toll-plaza.png',media_type='image/png');scene.render.filepath=preview.path;bpy.ops.render.render(write_still=True);preview.publish()
result={'roots':['KartRoot','TollPlazaRoot'],'driverPivots':['DriverTorso','DriverHead','DriverHands']}

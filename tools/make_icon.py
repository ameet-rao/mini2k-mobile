from PIL import Image
import math
N=36
px={}
def P(x,y,c):
    if 0<=x<N and 0<=y<N: px[(x,y)]=c
H=lambda h: tuple(int(h[i:i+2],16) for i in (1,3,5))
# background: arena night -> spotlight glow
for y in range(N):
    for x in range(N):
        d=math.hypot(x-17.5,y-13)
        t=min(1,d/26)
        a=(int(38-24*t),int(52-36*t),int(84-56*t))
        P(x,y,a)
# crowd dots in the dark top band (sparse)
import random; random.seed(7)
cols=[H('#c33a3a'),H('#3a66c3'),H('#d8d8d8'),H('#e0b84a'),H('#3a9a5a')]
for y in (1,3,5):
    for x in range(1,N,2):
        if random.random()<0.55 and math.hypot(x-17.5,y-13)>13: P(x+(y//2)%2-0,y,tuple(int(v*0.55) for v in random.choice(cols)))
# hardwood floor rows 25..35
for y in range(25,28):
    for x in range(N):
        base=H('#c98a4b') if (x//6+y)%2 else H('#d29655')
        if y==25: base=H('#f0e6d0')                        # sideline
        elif (x+ (y*3))%9==0: base=H('#b2763c')            # plank seams
        P(x,y,base)
# scoreboard strip
for y in range(28,N):
    for x in range(N): P(x,y,H('#0c111a') if y>28 else H('#33435e'))
# ball shadow on floor
for x in range(10,26):
    for y in (25,26):
        if abs(x-17.5)<(7.5 if y==26 else 5.5): P(x,y,H('#7a4d22') if y==26 else H('#a46a35'))
# ball
cx,cy,R=17.5,13.0,10.2
for y in range(N):
    for x in range(N):
        dx,dy=x+0.5-cx-0.0,y+0.5-cy
        d=math.hypot(dx,dy)
        if d<=R:
            l=(-dx-dy)/R*0.7  # light from top-left
            c=H('#f08a24')
            if l>0.45: c=H('#ffb45a')
            elif l>0.15: c=H('#f79a35')
            elif l<-0.55: c=H('#b5520f')
            elif l<-0.2: c=H('#d8701a')
            if d>R-1: c=H('#4a1e06')                       # outline
            P(x,y,c)
seam=H('#3a1606')
def onball(x,y): return math.hypot(x+0.5-cx,y+0.5-cy)<R-0.6
for y in range(N):
    if onball(17,y): P(17,y,seam)
for x in range(N):
    if onball(x,13): P(x,13,seam)
# curved side seams (arcs)
for t in range(0,360,2):
    a=math.radians(t)
    for sx in (-1,1):
        X=cx+sx*(R*1.55)-sx*math.cos(a)*R*1.25; Y=cy+math.sin(a)*R*1.25
        xi,yi=int(math.floor(X)),int(math.floor(Y))
        if onball(xi,yi) and abs(xi+0.5-cx)<R-1.5: P(xi,yi,seam)
# shine pixels
for (x,y) in [(12,7),(13,6),(11,8),(14,6)]: P(x,y,H('#ffe2b0'))
# text MINI2K, 5px tall glyphs
G={'M':["10001","11011","10101","10001","10001"],'I':["111","010","010","010","111"],'N':["1001","1101","1011","1001","1001"],
   '2':["1110","0001","0110","1000","1111"],'K':["1001","1010","1100","1010","1001"]}
word="MINI2K"; w=sum(len(G[c][0]) for c in word)+len(word)-1
x0=(N-w)//2; y0=30
x=x0
for ch in word:
    g=G[ch]
    for r,row in enumerate(g):
        for c,b in enumerate(row):
            if b=='1': P(x+c,y0+r,H('#ffd84a') if ch not in '2K' else H('#ff6a5a'))
    x+=len(g[0])+1
img=Image.new('RGB',(N,N))
for (x,y),c in px.items(): img.putpixel((x,y),c)
img.save('icon36.png')
def out(size,name):
    k=size//N; s=img.resize((N*k,N*k),Image.NEAREST)
    o=Image.new('RGB',(size,size),px[(0,N-1)]); 
    # pad: top uses bg colour, so paste centered and fill with edge stretch
    o=s.resize((size,size),Image.NEAREST) if size%N==0 else None
    if o is None:
        o=Image.new('RGB',(size,size)); o.paste(s.resize((size,size),Image.NEAREST))
    o.save(name)
out(180,'apple-touch-icon.png'); out(512,'icon-512.png'); out(192,'icon-192.png')
img.resize((360,360),Image.NEAREST).save('preview.png')

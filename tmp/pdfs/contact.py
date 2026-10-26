from PIL import Image,ImageDraw
import glob,os
fs=glob.glob('tmp/pdfs/page-*.jpg')
fs.sort(key=lambda x:int(x.rsplit('-',1)[1].split('.')[0]))
ims=[]
for f in fs:
 im=Image.open(f); im.thumbnail((330,430))
 canvas=Image.new('RGB',(350,460),'white'); canvas.paste(im,((350-im.width)//2,20))
 ImageDraw.Draw(canvas).text((10,4),os.path.basename(f),fill='black'); ims.append(canvas)
out=Image.new('RGB',(350*4,460*5),'#cccccc')
for i,im in enumerate(ims): out.paste(im,((i%4)*350,(i//4)*460))
out.save('tmp/pdfs/contact.jpg')

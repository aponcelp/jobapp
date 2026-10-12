import json,base64,re,html,glob,os,csv
def walk(p,out):
    mt=p.get('mimeType','');d=p.get('body',{}).get('data')
    if d and mt in('text/plain','text/html'):
        t=base64.urlsafe_b64decode(d+'==').decode('utf-8','ignore')
        out.append((mt,t))
    for c in p.get('parts',[]) or []: walk(c,out)
def text(m):
    out=[];walk(m['payload'],out)
    pl=[t for mt,t in out if mt=='text/plain']; 
    if pl: t=pl[0]
    elif out:
        t=re.sub(r'(?is)<(style|script).*?</\1>','',out[0][1]); t=re.sub(r'<br\s*/?>|</p>|</div>|</tr>','\n',t); t=re.sub(r'<[^>]+>',' ',t); t=html.unescape(t)
    else: t=m.get('snippet','')
    t=re.sub(r'\[image:[^\]]*\]','',t); t=re.sub(r'https?://\S+',lambda x:x.group(0) if any(k in x.group(0) for k in ['greenhouse.io/','ashbyhq.com/','lever.co/','linkedin.com/jobs/view','workable.com/','/jobs/']) and len(x.group(0))<150 else '',t)
    t=re.sub(r'[ \t\u200c\u00a0\u034f]+',' ',t); t=re.sub(r'\n\s*\n+','\n',t)
    return t.strip()
rows=[]
for f in glob.glob('bodies/*.json'):
    m=json.load(open(f)); h={x['name'].lower():x['value'] for x in m['payload']['headers']}
    t=text(m)
    rows.append(dict(id=m['id'],thread=m['threadId'],ts=int(m['internalDate']),frm=h.get('from',''),to=h.get('to',''),subj=h.get('subject',''),body=t))
rows.sort(key=lambda r:r['ts'])
json.dump(rows,open('msgs.json','w'))
print(len(rows))

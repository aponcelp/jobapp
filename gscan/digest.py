import json,re,datetime
rows=json.load(open('msgs.json'))
KW=re.compile(r'(position|role|applying|application for|application to|unfortunately|not (to )?(move|moving) forward|other candidates|pursue other|decided|filled|next step|interview|schedule|regret|no longer|closed|on hold|paused|offer|availability)',re.I)
out=[]
for r in rows:
    d=datetime.datetime.fromtimestamp(r['ts']/1000).strftime('%Y-%m-%d')
    b=r['body'].replace('\n',' ')
    sents=re.split(r'(?<=[.!?])\s+',b)
    keep=[s for s in sents if KW.search(s)][:4]
    k=' | '.join(s[:220] for s in keep)[:600]
    links=' '.join(sorted(set(re.findall(r'https?://\S+',r['body']))))[:200]
    fr=re.sub(r'<.*','',r['frm']).strip('" ')[:35]
    out.append(f"{d} {r['id']} [{fr}] {r['subj'][:90]} :: {k} {('LINK '+links) if links else ''}")
open('digest.txt','w').write('\n'.join(out))

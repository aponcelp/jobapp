import json,re,datetime
rows=json.load(open('msgs.json'))
KW=re.compile(r'(position|role|applying|application for|application to|unfortunately|not (to )?(move|moving) forward|other candidates|pursue other|decided|filled|interview|regret|no longer|closed|on hold|paused|offer|referred)',re.I)
out=[]
for r in rows:
    d=datetime.datetime.fromtimestamp(r['ts']/1000).strftime('%m-%d')
    if r['ts']<1772000000000: d=datetime.datetime.fromtimestamp(r['ts']/1000).strftime('%y-%m-%d')
    lines=[l for l in r['body'].split('\n') if not l.strip().startswith('>') and not re.match(r'\s*(El|On) .*(escribió|wrote)',l)]
    b=' '.join(lines)
    b=re.split(r'(El|On) [a-z]{3},? .{5,40}(escribió|wrote):',b)[0]
    sents=re.split(r'(?<=[.!?])\s+',b)
    keep=[s for s in sents if KW.search(s)][:3]
    k=' | '.join(s[:170] for s in keep)[:380]
    if re.match(r'(Invitaci|Evento|Updated|Invitation)',r['subj']): k=k[:160]
    fr=re.sub(r'<.*','',r['frm']).strip('" ')[:25]
    out.append(f"{d} {r['id'][-6:]} [{fr}] {r['subj'][:80]} :: {k}")
open('digest2.txt','w').write('\n'.join(out))

import json,sys,urllib.request,re,html
def get(u):
    with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=25) as r: return json.load(r)
def strip(h): return re.sub(r'\n\s*\n+','\n',html.unescape(re.sub(r'<[^>]+>','\n',html.unescape(h or ''))))
for u in sys.argv[1:]:
    try:
        if 'ashbyhq' in u:
            s,i=u.rstrip('/').split('/')[-2:]
            d=get(f'https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true')
            j=[x for x in d['jobs'] if x['id']==i]
            if not j: print('### CLOSED',u); continue
            j=j[0]; locs=[j.get('location')]+[x.get('location') for x in j.get('secondaryLocations') or []]
            head=f"{s} | {j['title']} | {locs} | {j.get('workplaceType')} remote={j.get('isRemote')} | {(j.get('compensation') or {}).get('compensationTierSummary')} | pub {j.get('publishedAt','')[:10]}"
            body=j.get('descriptionPlain') or strip(j.get('descriptionHtml'))
        elif 'greenhouse' in u:
            m=re.search(r'greenhouse.io/([^/]+)/jobs/(\d+)',u); s,i=m.groups()
            j=get(f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs/{i}')
            head=f"{s} | {j['title']} | {j['location']['name']} | pub {j.get('first_published')} upd {j.get('updated_at')}"
            body=strip(j.get('content'))
        elif 'lever' in u:
            s,i=u.rstrip('/').split('/')[-2:]
            j=get(f'https://api.lever.co/v0/postings/{s}/{i}')
            head=f"{s} | {j['text']} | {j['categories']} | {j.get('workplaceType')} | {j.get('salaryRange')}"
            body=j.get('descriptionPlain','')+'\n'+'\n'.join(l['text']+': '+strip(l['content']) for l in j.get('lists',[]))+'\n'+(j.get('additionalPlain') or '')
        fn=__import__("os").environ.get("JDD","jd")+'/'+re.sub(r'\W+','_',u)[-60:]+'.txt'
        open(fn,'w').write(head+'\n'+body)
        print('###',head,'->',fn,len(body))
    except Exception as e: print('### ERR',u,e)

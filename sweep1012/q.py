import json,sys,urllib.request,re
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as r: return json.load(r)
    except Exception as e: return None
pat=re.compile(sys.argv[2],re.I)
for s in sys.argv[1].split(','):
    d=get(f'https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true')
    if d and d.get('jobs') is not None:
        for j in d['jobs']:
            if pat.search(j['title']): print('ashby',s,'|',j['title'],'|',j.get('location'),j.get('workplaceType'),j.get('isRemote'),'|',(j.get('compensation') or {}).get('compensationTierSummary'),'|',j.get('publishedAt','')[:10],'|',j['jobUrl'])
        continue
    d=get(f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs')
    if d and 'jobs' in d:
        for j in d['jobs']:
            if pat.search(j['title']): print('gh',s,'|',j['title'],'|',j['location']['name'],'|',j.get('first_published') or j.get('updated_at'),'|',j['absolute_url'])
        continue
    d=get(f'https://api.lever.co/v0/postings/{s}?mode=json')
    if isinstance(d,list):
        for j in d:
            if pat.search(j['text']): print('lever',s,'|',j['text'],'|',j['categories'].get('location'),j.get('workplaceType'),'|',j.get('salaryRange'),'|',j['hostedUrl'])
        continue
    print('NONE',s)

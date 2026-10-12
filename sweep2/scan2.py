import json,re,sys,concurrent.futures as cf,urllib.request,datetime
slugs=[l.strip() for l in open(sys.argv[1]) if l.strip()]
T=re.compile(r'business op|bizops|biz ops|strateg.{0,6}op|chief of staff|special projects|strategic projects|head of op|founding op|first op|operations lead|lead, operations|product op|ai op|ai transformation|founder.?s office|strategic initiatives|operations generalist|head of business|strategic operations|operations manager|director of operations|vp.{0,4}operations|product manager|general manager',re.I)
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=15) as r: return json.load(r)
    except Exception: return None
def scan(s):
    out=[]
    d=get(f'https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true')
    if d and d.get('jobs') is not None:
        for j in d['jobs']:
            if T.search(j['title']):
                locs=[j.get('location') or '']+[x.get('location','') for x in (j.get('secondaryLocations') or [])]
                comp=(j.get('compensation') or {}).get('compensationTierSummary') or ''
                out.append(('ashby',s,j['title'],' / '.join(locs),str(j.get('isRemote'))+' '+(j.get('workplaceType') or ''),comp,(j.get('publishedAt') or '')[:10],j['jobUrl']))
        return out
    d=get(f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs')
    if d and 'jobs' in d:
        for j in d['jobs']:
            if T.search(j['title']): out.append(('gh',s,j['title'],j['location']['name'],'','',(j.get('first_published') or j.get('updated_at') or '')[:10],j['absolute_url']))
        return out
    d=get(f'https://api.lever.co/v0/postings/{s}?mode=json')
    if isinstance(d,list):
        for j in d:
            if T.search(j['text']):
                dt=datetime.datetime.utcfromtimestamp(j.get('createdAt',0)/1000).strftime('%Y-%m-%d')
                locs=j['categories'].get('allLocations') or [j['categories'].get('location')]
                out.append(('lever',s,j['text'],' / '.join(str(x) for x in locs),j.get('workplaceType'),str(j.get('salaryRange') or ''),dt,j['hostedUrl']))
    return out
with cf.ThreadPoolExecutor(48) as ex:
    for res in ex.map(scan,slugs):
        for r in res: print('\t'.join(str(x).replace('\t',' ').replace('\n',' ') for x in r))

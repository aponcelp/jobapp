import json,re,sys,concurrent.futures as cf,urllib.request
slugs=[l.strip() for l in open(sys.argv[1]) if l.strip()]
KW=re.compile(r'strateg|operations|bizops|chief of staff|head of op|deployment|special projects|program|transformation|forward deployed|product op|ai op',re.I)
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=15) as r: return json.load(r)
    except Exception: return None
def scan(s):
    out=[]
    d=get(f'https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true')
    if d and d.get('jobs') is not None:
        for j in d['jobs']:
            if KW.search(j['title']):
                comp=(j.get('compensation') or {}).get('compensationTierSummary') or ''
                out.append(('ashby',s,j['title'],j.get('location'),str(j.get('isRemote'))+' '+(j.get('workplaceType') or ''),comp,j.get('publishedAt','')[:10],j['jobUrl']))
        return out
    d=get(f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs')
    if d and 'jobs' in d:
        for j in d['jobs']:
            if KW.search(j['title']): out.append(('gh',s,j['title'],j['location']['name'],'','',(j.get('first_published') or j.get('updated_at') or '')[:10],j['absolute_url']))
        return out
    d=get(f'https://api.lever.co/v0/postings/{s}?mode=json')
    if isinstance(d,list):
        import datetime
        for j in d:
            if KW.search(j['text']):
                dt=datetime.datetime.utcfromtimestamp(j.get('createdAt',0)/1000).strftime('%Y-%m-%d')
                out.append(('lever',s,j['text'],j['categories'].get('location'),j.get('workplaceType'),str(j.get('salaryRange') or ''),dt,j['hostedUrl']))
    return out
with cf.ThreadPoolExecutor(64) as ex:
    for res in ex.map(scan,slugs):
        for r in res: print('\t'.join(str(x).replace('\t',' ').replace('\n',' ') for x in r))

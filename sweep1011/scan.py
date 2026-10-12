import json,re,sys,concurrent.futures as cf,urllib.request
slugs=sys.argv[1].split(',')
KW=re.compile(r'strateg|operations|bizops|business ops|chief of staff|revops|revenue op|head of op|deployment|special projects|customer success op|cs ops|support op|gtm op|go-to-market op|business operations|program',re.I)
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=20) as r: return json.load(r)
    except Exception: return None
def scan(s):
    out=[]
    d=get(f'https://api.ashbyhq.com/posting-api/job-board/{s}?includeCompensation=true')
    if d and d.get('jobs') is not None:
        for j in d['jobs']:
            if KW.search(j['title']):
                comp=(j.get('compensation') or {}).get('compensationTierSummary') or ''
                out.append(('ashby',s,j['title'],j.get('location'),j.get('isRemote'),comp,j['jobUrl']))
        return out or [('ashby',s,'-','','','','')]
    d=get(f'https://boards-api.greenhouse.io/v1/boards/{s}/jobs')
    if d and 'jobs' in d:
        for j in d['jobs']:
            if KW.search(j['title']): out.append(('gh',s,j['title'],j['location']['name'],'','',j['absolute_url']))
        return out or [('gh',s,'-','','','','')]
    d=get(f'https://api.lever.co/v0/postings/{s}?mode=json')
    if isinstance(d,list) and d:
        for j in d:
            if KW.search(j['text']): out.append(('lever',s,j['text'],j['categories'].get('location'),j.get('workplaceType'),str(j.get('salaryRange') or ''),j['hostedUrl']))
        return out or [('lever',s,'-','','','','')]
    return [('NONE',s,'','','','','')]
with cf.ThreadPoolExecutor(48) as ex:
    for res in ex.map(scan,slugs):
        for r in res: print('\t'.join(str(x) for x in r))

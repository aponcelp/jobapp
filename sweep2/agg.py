import json,urllib.request,urllib.parse,concurrent.futures as cf
terms=["chief of staff","business operations","bizops","strategy & operations","strategy and operations","strategy & ops","special projects","strategic projects","founder's office","founders office","head of operations","product operations","ai operations","ai transformation","strategic initiatives","operations lead","general manager","strategic operations","head of business","first operations","founding operations","operations generalist"]
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=30) as r: return json.load(r)
    except Exception as e: return None
def fetch(t,page,remote):
    q={'search':t,'page':page}
    if remote: q['remote']='true'
    return get('https://ashbyhq-scraper.vercel.app/api/jobs?'+urllib.parse.urlencode(q))
out={}
jobs=[]
for remote in (True,):
  for t in terms:
    d=fetch(t,1,remote)
    if not d: continue
    pages=d.get('totalPages',1)
    res=[d]
    with cf.ThreadPoolExecutor(8) as ex:
        res+=list(ex.map(lambda p:fetch(t,p,remote),range(2,min(pages,15)+1)))
    for r in res:
        if r:
            for x in r['data']: out[x['jobUrl']]=x
json.dump(list(out.values()),open('agg_remote.json','w'))
print(len(out))

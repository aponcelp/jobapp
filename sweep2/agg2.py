import json,urllib.request,urllib.parse,concurrent.futures as cf,sys,time
terms=sys.argv[1].split('|'); remote=sys.argv[2]=='1'
def get(u):
    try:
        with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=25) as r: return json.load(r)
    except Exception as e: return None
def fetch(a):
    t,page=a
    q={'search':t,'page':page}
    if remote: q['remote']='true'
    return get('https://ashbyhq-scraper.vercel.app/api/jobs?'+urllib.parse.urlencode(q))
t0=time.time()
with cf.ThreadPoolExecutor(16) as ex: firsts=list(ex.map(fetch,[(t,1) for t in terms]))
tasks=[]
for t,d in zip(terms,firsts):
    if d: tasks+=[(t,p) for p in range(2,min(d.get('totalPages',1),12)+1)]
print(time.time()-t0,len(tasks),file=sys.stderr)
with cf.ThreadPoolExecutor(24) as ex: rest=list(ex.map(fetch,tasks))
with open(sys.argv[3],'a') as f:
    for r in firsts+rest:
        if r:
            for x in r['data']: f.write(json.dumps(x)+'\n')
print(time.time()-t0,file=sys.stderr)

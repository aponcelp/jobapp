import json,re,sys,datetime
rows=json.load(open('msgs.json')); n=int(sys.argv[1]); ids=sys.argv[2:]
for r in rows:
    if any(r['id'].endswith(i) for i in ids):
        b=re.sub(r'\s+',' ',r['body'])
        b=re.sub(r'^.*?(Hi|Hello|Dear|Hey) Alfredo','Hi Alfredo',b,count=1) if 'Alfredo' in b[:800] else b
        print(datetime.datetime.fromtimestamp(r['ts']/1000).strftime('%Y-%m-%d'),r['id'][-6:],r['subj'][:60],'::',b[:n]); print()

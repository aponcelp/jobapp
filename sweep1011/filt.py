import re,sys
EX="Abacum, Affirm, Afresh, Airbnb, Alia, Dotdigital, Ambience Healthcare, Ambrook, Augment, Aurora Solar, Bounteous, Breezeway, Candid, Check, CircleCI, Cisco, Clutch, Commure, Counterpart, Cresta, Crux, Curri, DoorDash, Duvo, Eko Health, Engine, Everway, Fanbasis, Commas, Fetch, Fieldguide, Finni Health, Function Health, Go.AI, Harvey, Headway, Human Interest, Iru, Jane, Ketch, Maximum, Monarch Money, Motive, Neko Health, OuterSignal, Paper, Parloa, Presidio Creative, Prolific, Ramp, RevenueCat, Salt, Samsara, Sanity, Scribe, SentinelOne, Simpro, Smartcat, Sprout Social, Stedi, Steno, Supabase, Tremendous, Triptease, VU Venture Partners, Vesta, Wonderful, Wrapbook, Zapier, Zaya Care, Zillow, zerohash, ElevenLabs, Replicant, Nightfall AI, Daybreak Health, Hippocratic AI, brightwheel, Outmarket AI, Trellis AI, Octave, Apollo.io, Vector, Stripe, Tideline RCM, GitLab, BairesDev, Clipboard Health, Nebius, Equip, Sureify, Cyberhaven, Rula, Eagle, Viewline Ventures"
ex=set(re.sub(r'[^a-z0-9]','',x.lower()) for x in EX.split(','))
GOOD=re.compile(r'strategy|bizops|business op|chief of staff|revops|revenue op|head of op|operations lead|operations manager|director.*operations|operations.*director|deployment|special projects|customer op|cs op|support op|gtm op|post-sale|ai op|product op|head of business',re.I)
BAD=re.compile(r'engineer|analyst|sales op|enablement|intern|coordinator|associate|specialist|security|clinical|legal|people op|hr |talent|recruit|marketing|account exec|finance|accounting|tax|payroll|data op|ml |research|manufactur|supply|facilit|warehouse|field|fleet|site |mission|flight|launch|hardware|lab',re.I)
LOC=re.compile(r'remote|united states|\bus\b|usa|u\.s\.|north america|anywhere|miami|florida|true|americas',re.I)
NONUS=re.compile(r'canada|uk|london|europe|emea|india|apac|germany|brazil|mexico|latam|australia|singapore|israel|poland|spain|france',re.I)
for l in open(sys.argv[1]):
    f=l.rstrip('\n').split('\t')
    if f[0]=='NONE' or f[2]=='-': continue
    if re.sub(r'[^a-z0-9]','',f[1].lower()) in ex: continue
    loc=f[3]+' '+f[4]
    if GOOD.search(f[2]) and not BAD.search(f[2]) and LOC.search(loc) and not (NONUS.search(f[3]) and not re.search('US|United States',f[3])):
        print('\t'.join([f[1],f[2],f[3],f[4],f[5],f[6]]))

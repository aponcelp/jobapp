import sys,re
L=re.compile(r'remote|miami|florida|\bfl\b|united states|usa|\bus\b|americas|anywhere',re.I)
NL=re.compile(r'remote.{0,4}(canada|uk|europe|eu|india|brazil|mexico|latam|germany|spain|poland|emea|apac)',re.I)
X=re.compile(r'analyst|associate|intern|coordinator|specialist|sales|revenue|revops|gtm|go-to-market|people|enablement|support|onboarding|implementation|customer success|customer experience|cx |robot|clinic|engineer|security|finance|marketing|legal|it op|facilit|manufact|supply|warehouse|fleet|field|data op|clinical|recruit|talent|hr |technical|payments|risk|fraud|compliance|lab|pharmacy|nurs|care|member|provider|claims|billing|credit|lending|loan|underwrit|banking|treasury|tax|accounting|payroll|deal|partner|channel|account|mortgage|title|escrow|logistics|delivery|driver|hardware|network|infrastructure|platform|developer|api|ml|data scien|research|design|creative|brand|content|community|social|event',re.I)
for l in sys.stdin:
  f=l.rstrip('\n').split('\t')
  if len(f)<8: continue
  loc=f[3]+' '+f[4]
  if not L.search(loc) : continue
  if NL.search(loc) and not re.search(r'united states|remote.{0,3}us|usa|miami',loc,re.I): continue
  if X.search(f[2]): continue
  if f[6] and f[6]<'2026-07-01': continue
  print('\t'.join([f[1],f[2],f[3][:60],f[4],f[5][:40],f[6],f[7]]))

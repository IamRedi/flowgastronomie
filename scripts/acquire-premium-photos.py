import urllib.request,re,html,json,hashlib
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
root=Path.cwd()
photos=[('pizzeria','pizza-with-berries-MQUqbmszGGM','Ivan Torres'),('restaurant','grilled-meat-zGeax2IzgVw','David V'),('fast_food','hamburger-by-french-fries-on-board-uVPV_nV17Tw','sk'),('bakery','four-croissant-bread-0UXMMXXupL0','Lucas Mellec'),('cafe','croissant-bread-with-cappuccino-coffee-ymtPhYNK49A','Lex Sirikiat'),('ice_cafe','bowl-of-ice-cream-iT4qcNMhYTQ','Dovile Ramoskaite'),('doner','grilled-meat-and-vegetable-on-the-table-UC0HZdUitWY','Victoria Shes'),('bar','cocktail-glass-mRC4D1lgSoA','Sebastian Coman Photography'),('imbiss','a-plate-of-food-H0BirSjvsQY','Mirko Fabian')]
def get(url):
 return urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'}),timeout=35).read()
def fetch(row):
 key,slug,author=row;source='https://unsplash.com/photos/'+slug
 ids={'pizzeria':'1513104890138-7c749659a591','restaurant':'1558199141-391d935676f0','bakery':'1544027026-31fbbad5ecee','cafe':'1525596201491-f6eae338a205','ice_cafe':'1570197788417-0e82375c9371','doner':'1555939594-58d7cb561ad1','bar':'1576670393064-0063c3492d38','fast_food':'1551782450-a2132b4ba21d','imbiss':'1651307445227-4aafdd2d23b3'}
 url='https://images.unsplash.com/photo-'+ids[key]+'?fit=crop&w=1200&q=82&fm=webp'
 data=get(url)
 if len(data)>700000:raise Exception('Image too big')
 p=root/'apps/web/public/showcases'/f'{key}.webp';p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(data)
 return dict(profileId=key.upper(),file=f'{key}.webp',source=source,author=author,license='Unsplash License',licenseUrl='https://unsplash.com/license',verifiedOn='2026-10-08',sha256=hashlib.sha256(data).hexdigest(),bytes=len(data),usage='Illustrative stock hero only; not actual business/product photography',download=url)
results=[]
with ThreadPoolExecutor(max_workers=4) as pool:
 for result in pool.map(fetch,photos):
  results.append(result);print(result['file'],result['bytes'])
p=root/'apps/web/public/showcases/sources.json';p.write_text(json.dumps(results,ensure_ascii=False,indent=2),encoding='utf-8')

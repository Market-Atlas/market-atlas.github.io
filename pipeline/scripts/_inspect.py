import json
for t in ['RELIANCE', 'TCS', 'AAPL']:
    d = json.load(open(f'data/companies/{t}.json'))
    h = d['historicalFinancials']
    print(t, 'ccy=', d['currency'], 'sector=', d.get('sector'),
          'years=', len(h),
          'latestRev=', h[-1].get('revenue') if h else None,
          'mcap=', d['marketCap']['value'])

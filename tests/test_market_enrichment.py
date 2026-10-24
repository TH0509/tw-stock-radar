import sys
import unittest
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from market_enrichment import otc_prices, otc_flows

class MarketEnrichmentTest(unittest.TestCase):
    def test_otc_prices(self):
        fields=['代號','名稱','收盤','漲跌','開盤','最高','最低','成交股數']
        rows=[[str(5000+i),'測試股','100','+1','99','101','98','120,000'] for i in range(25)]
        got=otc_prices({'tables':[{'fields':fields,'data':rows}]})
        self.assertEqual(got['5000']['volume_shares'],120000)
        self.assertEqual(got['5000']['close'],100.0)
    def test_otc_accounting_guard(self):
        def r(i, invalid=False):
            row=['0']*24;row[0]=str(5000+i);row[1]='測試股'
            row[4]='-2000';row[13]='1000';row[16]='100';row[19]='-500'
            row[22]='-400';row[23]='999' if invalid else '-1400'
            return row
        data=[r(i) for i in range(25)]+[r(40,True)]
        got=otc_flows({'tables':[{'fields':list(range(24)),'data':data}]})
        self.assertEqual(got['5000']['foreign'],-2)
        self.assertNotIn('5040',got)

if __name__=='__main__':
    unittest.main()

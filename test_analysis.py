import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from analysis import sma, roc, rsi_wilder, summarize_institutions, build_stock, signal


class AnalysisTest(unittest.TestCase):
    def test_sma_and_roc(self):
        p = [10, 20, 30, 40]
        self.assertEqual(sma(p, 2), [None, 15, 25, 35])
        self.assertEqual(roc(p, 2), [None, None, 200, 100])

    def test_rsi_constant_and_upward(self):
        self.assertEqual(rsi_wilder([100]*16)[-1], 50)
        self.assertEqual(rsi_wilder(list(range(1, 18)))[-1], 100)
        self.assertEqual(rsi_wilder(list(range(17, 0, -1)))[-1], 0)

    def test_institution_subcategories_and_lots(self):
        rows = [
            {'date':'2026-10-23','name':'Foreign_Investor','buy':6000,'sell':2000},
            {'date':'2026-10-23','name':'Foreign_Dealer_Self','buy':0,'sell':1000},
            {'date':'2026-10-23','name':'Investment_Trust','buy':4000,'sell':3000},
            {'date':'2026-10-23','name':'Dealer_self','buy':500,'sell':0},
            {'date':'2026-10-23','name':'Dealer_Hedging','buy':0,'sell':1500},
            {'date':'2026-10-23','name':'Other','buy':1000,'sell':0},
        ]
        day = summarize_institutions(rows)['2026-10-23']
        self.assertEqual(day['foreign'], 3)
        self.assertEqual(day['trust'], 1)
        self.assertEqual(day['dealer'], -1)
        self.assertEqual(day['total'], 3)

    def test_missing_day_is_null(self):
        prices = [{'date':f'2026-09-{i:02}', 'close':i+10, 'Trading_Volume':1000} for i in range(1,29)]
        inst = [{'date':'2026-09-28','name':'Foreign_Investor','buy':2000,'sell':500}]
        out=build_stock('2330','台積電', prices,inst)
        self.assertIsNone(out['points'][-2]['foreign'])
        self.assertEqual(out['points'][-1]['foreign'],1.5)
        self.assertEqual(out['flows']['d5']['count'],1)
        self.assertEqual(out['last_institution_date'],'2026-09-28')

    def test_signal(self):
        self.assertEqual(signal(110,108,100,5),'偏多')
        self.assertEqual(signal(90,92,100,-5),'偏弱')
        self.assertEqual(signal(110,95,100,5),'盤整')
        self.assertEqual(signal(None,95,100,5),'資料不足')

    def test_insufficient_history_rejected(self):
        with self.assertRaises(ValueError):
            build_stock('2330','台積電',[{'date':str(i),'close':10} for i in range(10)],[])


if __name__ == '__main__':
    unittest.main()

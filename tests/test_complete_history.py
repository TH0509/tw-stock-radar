import json
import sys
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from scanner import prices, institutional_complete
from market_enrichment import otc_prices
from analysis import build_stock
from market_history import materialize


class CompleteHistoryTest(unittest.TestCase):
    def test_twse_ohlc_and_reject_broken_candle(self):
        h = ["證券代號","證券名稱","成交股數","開盤價","最高價","最低價","收盤價"]
        body = [[str(5000+i),"測試股票","90,000","50","55","49","52"] for i in range(25)]
        body.append(["5200","壞資料","90,000","50","40","49","52"])
        r=prices({"fields":h,"data":body})
        self.assertEqual(r["5000"]["open"],50)
        self.assertEqual(r["5000"]["high"],55)
        self.assertEqual(r["5000"]["low"],49)
        self.assertEqual(r["5000"]["close"],52)
        self.assertNotIn("5200",r)

    def test_institution_categories(self):
        h = ["證券代號","證券名稱",
             "外陸資買賣超股數(不含外資自營商)","外資自營商買賣超股數",
             "投信買賣超股數","自營商買賣超股數"]
        data = [[str(5000+i),"測試股","-2,000","500","2,000","-300"] for i in range(25)]
        result=institutional_complete({"fields":h,"data":data})["5000"]
        self.assertEqual(result["foreign"],-1.5)
        self.assertEqual(result["foreign_ex_dealer"],-2)
        self.assertEqual(result["trust"],2)
        self.assertEqual(result["dealer"],-.3)

    def test_indicator_has_true_candles(self):
        price=[{"date":f"2026-09-{i:02}","open":95,"max":110,"min":90,
                "close":100+i/10,"Trading_Volume":1000} for i in range(1,29)]
        s=build_stock("2330","測試",price,[])
        self.assertEqual(s["points"][-1]["high"],110)
        self.assertEqual(s["points"][-1]["low"],90)
        self.assertIsNone(s["points"][-1]["foreign"])

    def test_materialized_every_stock_same_schema(self):
        day=datetime(2026,10,23,tzinfo=timezone(timedelta(hours=8)))
        payload={}
        for i in range(25):
            dt=(day-timedelta(days=i)).date().isoformat()
            payload[dt]={
                "tw_price": {"2330":{"name":"台積電","open":100,"high":110,
                              "low":90,"close":105,"volume":150000},
                             "3017":{"name":"奇鋐","open":300,"high":312,
                              "low":295,"close":305,"volume":50000}},
                "tw_inst": {"2330":{"foreign":100,"trust":-10,"dealer":2,
                             "foreign_ex_dealer":90},
                            "3017":{"foreign":30,"trust":4,"dealer":-3,
                             "foreign_ex_dealer":30}}
            }
        with tempfile.TemporaryDirectory() as td:
            out=Path(td)
            snap=materialize(payload,out,day)
            self.assertIn("2330",snap["stocks"])
            self.assertIn("3017",snap["stocks"])
            self.assertEqual(snap["stocks"]["3017"]["coverage_days"],25)
            stock=json.loads((out/"market/3017.json").read_text(encoding="utf-8"))
            self.assertEqual(len(stock["points"]),25)
            self.assertEqual(stock["points"][0]["open"],300)
            self.assertEqual(stock["points"][-1]["ma20"],305)
            self.assertEqual(stock["flows"]["d5"]["count"],5)
            self.assertEqual(stock["flows"]["d5"]["total"],155)

    def test_otc_short_records_rejected(self):
        self.assertEqual(otc_prices({"tables":[{"fields":["代號"],"data":[["5000"]]}]}),{})


if __name__ == "__main__":
    unittest.main()

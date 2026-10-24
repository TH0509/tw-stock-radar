import sys,unittest
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/"scripts"))
from scanner import qualifies,snapshot
class TestScanner(unittest.TestCase):
 def test_positive(self):
  d=[{"foreign":-1,"volume":100},{"foreign":1,"volume":100},{"foreign":2,"volume":100},{"foreign":3,"volume":120}]
  self.assertTrue(qualifies(d))
 def test_missing_or_zero_not_buy(self):
  d=[{"foreign":-1,"volume":100},{"foreign":0,"volume":100},{"foreign":2,"volume":100},{"foreign":3,"volume":120}]
  self.assertFalse(qualifies(d))
  d[1]["foreign"]=1;d[-1]["volume"]=119
  self.assertFalse(qualifies(d))
  self.assertFalse(qualifies(d[:3]))
 def test_snapshot(self):
  dates=["2026-10-20","2026-10-21","2026-10-22","2026-10-23"]
  inst={dt:{"2330":{"name":"台積電","foreign":f}} for dt,f in zip(dates,[-1,1,2,3])}
  prices={dt:{"2330":{"volume":v,"close":100}} for dt,v in zip(dates,[90,100,100,120])}
  self.assertEqual(snapshot(inst,prices)["matches"],["2330"])
if __name__=="__main__":unittest.main()

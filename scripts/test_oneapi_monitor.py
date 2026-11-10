import importlib.util
from pathlib import Path
import unittest
spec=importlib.util.spec_from_file_location('collector',Path(__file__).with_name('collect-oneapi-metrics.py'))
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
class CountersTest(unittest.TestCase):
    def test_rates_and_zero(self):
        a=dict(clock=10,boot='a',interface='eth0',total=100,idle=50,rx=100,tx=200)
        b=dict(clock=20,boot='a',interface='eth0',total=200,idle=125,rx=200,tx=200)
        r=module.delta_metrics(a,b)
        self.assertEqual(r['cpu_percent'],25)
        self.assertEqual(r['rx_bps'],80)
        self.assertEqual(r['tx_bps'],0)
    def test_restart_reset_and_stale(self):
        a=dict(clock=10,boot='a',interface='eth0',total=100,idle=50,rx=100,tx=200)
        b=dict(a,clock=20,boot='b')
        self.assertIsNone(module.delta_metrics(a,b)['cpu_percent'])
        b=dict(a,clock=20,total=200,idle=150,rx=50,interface='eth1')
        self.assertIsNone(module.delta_metrics(a,b)['rx_bps'])
        self.assertEqual(module.delta_metrics(a,b)['cpu_percent'],0)
        self.assertIsNone(module.delta_metrics(a,dict(b,clock=200))['sample_seconds'])
if __name__=='__main__':unittest.main()

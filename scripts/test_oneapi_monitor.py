import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
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
class UsageTest(unittest.TestCase):
    def update(self, old, new, stamp='2026-11-17T02:00:00+00:00'):
        with patch.object(module,'backup_inventory',return_value={'status':'unavailable'}):
            return module.update_usage(old,new,stamp)
    def sample(self, clock=10, rx=100, tx=200, identity='a'):
        return dict(clock=clock,boot='boot',project_network=dict(identity=identity,rx=rx,tx=tx))
    def test_no_backfill_and_exact_observed_delta(self):
        a=self.sample();a['usage_meter']=self.update({},a)
        self.assertEqual(a['usage_meter']['days'][0]['tx_bytes'],0)
        b=self.sample(25,130,250);m=self.update(a,b)
        self.assertEqual(m['days'][0]['tx_bytes'],50)
        self.assertEqual(m['days'][0]['rx_bytes'],30)
        self.assertEqual(m['days'][0]['observed_seconds'],15)
        self.assertFalse(m['allocation_ready'])
    def test_restart_reset_gap_and_midnight_are_not_billed(self):
        a=self.sample();a['usage_meter']=self.update({},a)
        for b in [self.sample(25,130,250,'new'),self.sample(25,0,0),self.sample(200,200,300),dict(clock=25,boot='new',project_network=self.sample()['project_network'])]:
            m=self.update(a,b);self.assertEqual(m['days'][0]['tx_bytes'],0);self.assertEqual(m['days'][0]['gaps'],1)
        m=self.update(a,self.sample(25,130,250),'2026-11-17T16:00:01+00:00')
        self.assertEqual(m['days'][-1]['date'],'2026-11-18');self.assertEqual(m['days'][-1]['tx_bytes'],0)
    def test_unknown_network_is_not_zero_usage(self):
        m=self.update({},dict(clock=10,boot='boot',project_network=None))
        self.assertEqual(m['network_status'],'unavailable');self.assertEqual(m['days'][0]['observed_seconds'],0)

if __name__=='__main__':unittest.main()

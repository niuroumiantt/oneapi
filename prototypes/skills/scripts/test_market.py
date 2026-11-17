"""Offline regression checks for external parsers and failure-safe local snapshots."""
import copy
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error

spec=importlib.util.spec_from_file_location('market',Path(__file__).with_name('update-market.py'))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def github_fixture(count=10):
    return ''.join(f'<article class="Box-row"><h2><a href="/owner/repo{i}">owner / repo{i}</a></h2><p>Example &amp; project</p><a href="/owner/repo{i}/stargazers">1,234</a><span itemprop="programmingLanguage">Python</span><span>{500 if i==5 else 100-i} stars today</span></article>' for i in range(1,count+1))

def board_fixture():
    return ''.join(f'<a href="/owner/repo{i}/skill"><span>{i}</span><h3>skill</h3><p>owner/repo{i}</p><span>1.2K</span></a>' for i in range(1,11))

class MarketTests(unittest.TestCase):
    def test_github_official_order_not_star_sort(self):
        rows=m.parse_github(github_fixture())
        self.assertEqual([r['rank'] for r in rows],list(range(1,11)))
        self.assertEqual(rows[0]['stars'],1234)
        self.assertEqual(rows[0]['starsToday'],99)
        self.assertEqual(rows[4]['starsToday'],500)
        self.assertEqual(rows[4]['repo'],'owner/repo5')
        self.assertEqual(rows[0]['description'],'Example & project')
    def test_partial_or_challenge_page_rejected(self):
        for source in [github_fixture(9),'<html>Sign in to continue</html>',github_fixture().replace('stars today','downloads today')]:
            with self.assertRaises(ValueError):m.parse_github(source)
    def test_install_units_and_absence(self):
        self.assertEqual(m.parse_count('1.1M'),1100000)
        self.assertEqual(m.parse_count('21'),21)
        self.assertEqual(m.parse_skill_count('<div>Installs <b>28.7K</b> Repository</div>')['countApprox'],28700)
        with self.assertRaises(ValueError):m.parse_skill_count('<div>GitHub Stars 300K</div>')
        self.assertEqual(m.parse_leaderboard(board_fixture())['owner/repo1/skill']['rank'],1)
    def test_failed_refresh_keeps_previous_data_and_date(self):
        old={'schemaVersion':1,'github':{'updatedAt':'2026-11-01T00:00:00Z','items':m.parse_github(github_fixture())},'popularity':{'owner/missing/skill':{'display':'8.0K','countApprox':8000,'checkedAt':'2026-11-01T00:00:00Z'}}}
        before=copy.deepcopy(old)
        def unavailable(url):raise urllib.error.HTTPError(url,503,'Unavailable',{},None)
        result=m.refresh(old,[{'repo':'owner/missing','slug':'skill'}],unavailable,'2026-11-17T00:00:00Z')
        self.assertEqual(old,before)
        self.assertEqual(result['github']['updatedAt'],before['github']['updatedAt'])
        self.assertEqual(result['github']['items'],before['github']['items'])
        self.assertEqual(result['github']['status'],'error')
        self.assertEqual(result['popularity']['owner/missing/skill']['countApprox'],8000)
        self.assertEqual(result['popularity']['owner/missing/skill']['status'],'stale')
    def test_unknown_metric_is_not_zero(self):
        def get(url):
            if url==m.GITHUB_URL:return github_fixture()
            if url==m.SKILLS_URL:return board_fixture()
            raise urllib.error.HTTPError(url,404,'Not found',{},None)
        result=m.refresh({},[{'repo':'owner/unknown','slug':'skill'}],get,'2026-11-17T00:00:00Z')
        self.assertNotIn('countApprox',result['popularity']['owner/unknown/skill'])
        self.assertEqual(result['popularity']['owner/unknown/skill']['status'],'unavailable')
        self.assertEqual(result['github']['status'],'ok')
    def test_atomic_json_and_actual_snapshot(self):
        with tempfile.TemporaryDirectory() as temp:
            path=Path(temp)/'snapshot.json';m.atomic_write(path,{'text':'中文 & <script>'})
            self.assertEqual(json.loads(path.read_text())['text'],'中文 & <script>')
            self.assertEqual(len(list(Path(temp).iterdir())),1)
        data=json.loads((m.ROOT/'market-data.json').read_text())
        self.assertEqual(data['schemaVersion'],1)
        rows=data.get('github',{}).get('items',[])
        if rows:
            self.assertEqual(len(rows),10)
            self.assertEqual([r['rank'] for r in rows],list(range(1,11)))
            self.assertTrue(all(r['url']=='https://github.com/'+r['repo'] for r in rows))
        catalog=json.loads((m.ROOT/'market-sources.json').read_text())
        self.assertEqual(len(catalog),40)
        self.assertEqual(len({r['id'] for r in catalog}),40)

if __name__=='__main__':unittest.main()

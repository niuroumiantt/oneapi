#!/usr/bin/env python3
"""Refresh public market snapshots without publishing, installing Skills or using credentials."""
import argparse
import concurrent.futures
import datetime as dt
import hashlib
import html
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parents[1]
GITHUB_URL = 'https://github.com/trending?since=daily'
SKILLS_URL = 'https://skills.sh'
COUNT = r'\d[\d,]*(?:\.\d+)?[KMB]?'

def visible_text(source):
    source = re.sub(r'<(?:script|style)\b[^>]*>.*?</(?:script|style)>', '', source, flags=re.S | re.I)
    return ' '.join(html.unescape(re.sub(r'<[^>]+>', ' ', source)).split())

def parse_count(value):
    if not re.fullmatch(COUNT, value):
        raise ValueError('Unrecognized count')
    factor = {'K':1000, 'M':1000000, 'B':1000000000}.get(value[-1], 1)
    return round(float((value[:-1] if factor != 1 else value).replace(',', '')) * factor)

def parse_github(source):
    articles = re.findall(r'<article\b[^>]*class="[^"]*\bBox-row\b[^"]*"[^>]*>(.*?)</article>', source, re.S)
    if len(articles) < 10:
        raise ValueError('GitHub returned fewer than 10 rows; keep previous snapshot')
    rows = []
    for position, article in enumerate(articles[:10], 1):
        heading = re.search(r'<h2\b[^>]*>(.*?)</h2>', article, re.S)
        link = re.search(r'href="/([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)"', heading[1] if heading else '')
        today = re.search(r'([\d,]+) stars? today\b', visible_text(article))
        if not link or not today:
            raise ValueError('GitHub row schema changed; keep previous snapshot')
        repo = link[1]
        stars = re.search(r'<a\b[^>]*href="/'+re.escape(repo)+r'/stargazers"[^>]*>(.*?)</a>', article, re.S)
        description = re.search(r'<p\b[^>]*>(.*?)</p>', article, re.S)
        language = re.search(r'<span\b[^>]*itemprop="programmingLanguage"[^>]*>(.*?)</span>', article, re.S)
        rows.append(dict(rank=position,repo=repo,url='https://github.com/'+repo,
                         description=visible_text(description[1]) if description else '',
                         stars=parse_count(visible_text(stars[1])) if stars else None,
                         starsToday=parse_count(today[1]),language=visible_text(language[1]) if language else None))
    if len({row['repo'].lower() for row in rows}) != 10:
        raise ValueError('Duplicate GitHub rows')
    return rows

def parse_leaderboard(source):
    result = {}
    for href, inner in re.findall(r'<a\b[^>]*href="([^"]+)"[^>]*>(.*?)</a>', source, re.S):
        match = re.fullmatch(r'/(?:[A-Za-z0-9_.-]+/){2}[A-Za-z0-9_.-]+', href)
        if not match or '<h3' not in inner:
            continue
        text = visible_text(inner)
        rank = re.match(r'^(\d+)\s', text)
        count = re.search(r'\s('+COUNT+r')$', text)
        if rank and count:
            result[href[1:].lower()] = dict(rank=int(rank[1]),display=count[1],countApprox=parse_count(count[1]))
    if len(result) < 10:
        raise ValueError('Skills leaderboard schema changed')
    return result

def parse_skill_count(source):
    match = re.search(r'\bInstalls\s+('+COUNT+r')\s+Repository\b', visible_text(source))
    if not match:
        raise ValueError('Install count missing; do not infer zero')
    return dict(display=match[1],countApprox=parse_count(match[1]))

def fetch(url):
    req = urllib.request.Request(url,headers={'User-Agent':'semifly-skills-catalog/1.0','Accept-Language':'en-US,en;q=0.8'})
    with urllib.request.urlopen(req,timeout=35) as response:
        body = response.read(12_000_001)
        if len(body) > 12_000_000:
            raise ValueError('Source larger than expected')
        return body.decode('utf-8')

def error_label(exc):
    # Never copy a remote HTML error or environment details into the public snapshot.
    return 'HTTP '+str(exc.code) if isinstance(exc,urllib.error.HTTPError) else type(exc).__name__

def refresh(old, catalog, get=fetch, now=None):
    now = now or dt.datetime.now(dt.timezone.utc).isoformat(timespec='seconds')
    data = json.loads(json.dumps(old)) if old else {'schemaVersion':1,'github':{},'popularity':{}}
    data['lastAttemptAt'] = now
    errors = []
    try:
        source = get(GITHUB_URL)
        data['github'] = dict(sourceUrl=GITHUB_URL,updatedAt=now,status='ok',scope='all languages / daily',
                              metric='GitHub official order; stars today are not downloads',
                              sourceSha256=hashlib.sha256(source.encode()).hexdigest(),items=parse_github(source))
    except Exception as exc:
        data['github'] = {**data.get('github',{}),'status':'error','lastAttemptAt':now,'error':error_label(exc)}
        errors.append('github: '+error_label(exc))
    try:
        leaderboard = parse_leaderboard(get(SKILLS_URL))
    except Exception as exc:
        leaderboard = {}
        errors.append('skills leaderboard: '+error_label(exc))
    def metric(row):
        key = (row['repo']+'/'+row['slug']).lower()
        url = SKILLS_URL+'/'+key
        try:
            if key in leaderboard:
                item = dict(leaderboard[key])
            else:
                source = get(url)
                item = {**parse_skill_count(source),'rank':None,'sourceSha256':hashlib.sha256(source.encode()).hexdigest()}
            return key,{**item,'sourceUrl':url,'checkedAt':now,'status':'ok','metric':'skills.sh recorded installs; rounded public display; not unique users or all GitHub downloads'},None
        except Exception as exc:
            previous = data.get('popularity',{}).get(key,{})
            unavailable = isinstance(exc,urllib.error.HTTPError) and exc.code == 404
            # Keep known counts and original checkedAt even when the source later vanishes.
            status = 'stale' if previous.get('checkedAt') else ('unavailable' if unavailable else 'error')
            return key,{**previous,'sourceUrl':url,'status':status,'lastAttemptAt':now,'error':error_label(exc)},None if unavailable else key+': '+error_label(exc)
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for key,item,error in pool.map(metric,catalog):
            data.setdefault('popularity',{})[key] = item
            if error: errors.append(error)
    data['errors'] = errors
    return data

def atomic_write(path, data):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp = tempfile.mkstemp(prefix=path.name+'.',suffix='.tmp',dir=path.parent)
    try:
        os.fchmod(fd,0o644)  # Public snapshot, readable by the static server.
        with os.fdopen(fd,'w') as handle:
            json.dump(data,handle,ensure_ascii=False,indent=2)
            handle.write('\n');handle.flush();os.fsync(handle.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output',type=Path,default=ROOT/'market-data.json')
    args=parser.parse_args()
    catalog=json.loads((ROOT/'market-sources.json').read_text())
    old=json.loads(args.output.read_text()) if args.output.exists() else {}
    data=refresh(old,catalog)
    atomic_write(args.output,data)
    known=sum(1 for m in data['popularity'].values() if m.get('countApprox') is not None)
    print(json.dumps({'github':data['github'].get('status'),'githubUpdatedAt':data['github'].get('updatedAt'),
                      'knownInstallCounts':known,'catalogSize':len(catalog),'errors':data['errors']},ensure_ascii=False))
    return 1 if data['errors'] else 0

if __name__=='__main__':
    raise SystemExit(main())

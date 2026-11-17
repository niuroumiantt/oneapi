"""Local adapter for the pinned upstream XLSX Skill; does not modify its files.

Use: python recalc-local.py --skill-script /path/to/xlsx/scripts/recalc.py workbook.xlsx
Only the engine invocation is replaced; upstream cache writing and reporting remain.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time
import zipfile
import xml.etree.ElementTree as ET

UPSTREAM_SHA256 = '7265aa4a41f5273596ee5694ce8a4d881c18adafb6203fece769107d08403263'


def convert_and_write(upstream, filename, abs_path, copy, timeout, profile_dir):
    # Conversion can reuse stale caches. Clear formula caches ONLY in the
    # disposable input copy, then let the engine compute them afresh.
    namespace = '{http://schemas.openxmlformats.org/spreadsheetml/2006/main}'
    parts = {}
    with zipfile.ZipFile(copy) as archive:
        for _, part in upstream._worksheets(archive):
            tree = upstream._xml(archive.read(part), part)
            for cell in tree.iter(namespace + 'c'):
                if cell.find(namespace + 'f') is not None:
                    for value in list(cell.findall(namespace + 'v')):
                        cell.remove(value)
            parts[part] = ET.tostring(tree, encoding='utf-8', xml_declaration=True)
        workbook = upstream._workbook_part(archive)
        tree = upstream._xml(archive.read(workbook), workbook)
        calculation = tree.find(namespace + 'calcPr')
        if calculation is None:
            calculation = ET.SubElement(tree, namespace + 'calcPr')
        calculation.set('calcMode', 'auto')
        calculation.set('fullCalcOnLoad', '1')
        calculation.set('forceFullCalc', '1')
        parts[workbook] = ET.tostring(tree, encoding='utf-8', xml_declaration=True)
    upstream._replace_parts(copy, parts)
    output = Path(copy).parent.parent / 'converted' 
    output.mkdir()
    command = ['soffice', '--headless', '--norestore',
               f'-env:UserInstallation={profile_dir.as_uri()}',
               '--convert-to', 'xlsx:Calc MS Excel 2007 XML',
               '--outdir', str(output), copy]
    options = dict(stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
                   env=upstream.get_soffice_env())
    if os.name == 'posix':
        options['start_new_session'] = True
    try:
        process = subprocess.Popen(command, **options)
        try:
            stdout, stderr = process.communicate(timeout=timeout)
        except subprocess.TimeoutExpired:
            # Terminate only this invocation and its children, never other Office sessions.
            if os.name == 'posix':
                os.killpg(process.pid, signal.SIGKILL)
            else:
                process.kill()
            process.communicate()
            return {'error': f'Local conversion exceeded {timeout}s; workbook unchanged'}
    except OSError as error:
        return {'error': str(error)}
    converted = output / Path(copy).name
    if process.returncode or not converted.is_file():
        return {'error': f'Conversion failed; workbook unchanged: {stderr.strip() or stdout.strip()}'}
    try:
        found = upstream._write_values(abs_path, str(converted))
        return upstream._report(filename, found)
    except Exception as error:
        return {'error': f'Cache write/report failed: {error}'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skill-script', type=Path, required=True)
    parser.add_argument('--timeout', type=int, default=30)
    parser.add_argument('workbook', type=Path)
    args = parser.parse_args()
    if args.timeout <= 0:
        parser.error('timeout must be positive')
    if args.workbook.suffix.lower() != '.xlsx':
        parser.error('this tested local adapter supports .xlsx only')
    script = args.skill_script.resolve()
    if hashlib.sha256(script.read_bytes()).hexdigest() != UPSTREAM_SHA256:
        parser.error('upstream recalc.py differs from the tested fixed version')
    sys.path.insert(0, str(script.parent))
    spec = importlib.util.spec_from_file_location('skill_upstream_recalc', script)
    upstream = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(upstream)
    upstream._recalc_with_profile = lambda *a: convert_and_write(upstream, *a)
    started = time.monotonic()
    result = upstream.recalc(str(args.workbook), args.timeout)
    result['local_adapter'] = {'engine': 'LibreOffice conversion + upstream cache-only writer',
                               'upstream_sha256': UPSTREAM_SHA256,
                               'elapsed_seconds': round(time.monotonic()-started, 3)}
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0 if result.get('status') == 'success' else 1


if __name__ == '__main__':
    sys.exit(main())

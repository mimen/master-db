#!/usr/bin/env python3
"""Read-only snapshot capture. Default is Master only; --complete needs lane release."""
import argparse, datetime, hashlib, json, os, pathlib, subprocess, sys, time, urllib.request, urllib.parse

ARCHIVE = pathlib.Path('/Users/mimen/.local/state/migration-deletions/final-20261018/C')
ENV = {**os.environ, 'CONVEX_DEPLOYMENT': 'dev:shiny-gerbil-853'}
ENDPOINT = 'https://dusty-manatee-615.convex.site/canonical-contacts/read'


def cli(args):
    result = subprocess.run(['bunx', 'convex', *args], env=ENV, capture_output=True, text=True)
    if result.returncode:
        raise RuntimeError('Read-only Convex command failed; raw output withheld')
    return result.stdout


def save(path, value):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, 'w') as stream:
        json.dump(value, stream)
        stream.write('\n')
    os.chmod(path, 0o600)


def table(name):
    cursor, rows = None, []
    for _ in range(1000):
        query = 'return await ctx.db.query(' + json.dumps(name) + ').paginate({cursor:' + json.dumps(cursor) + ',numItems:500});'
        page = json.loads(cli(['run', '--inline-query', query, '--typecheck', 'disable', '--codegen', 'disable']))
        rows.extend(page['page'])
        if page['isDone']:
            return rows
        cursor = page['continueCursor']
    raise RuntimeError('Read pagination safety limit exceeded')


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Redirect denied')


def request(url, token, body=None):
    if not (url == ENDPOINT or url.startswith('https://api.airtable.com/v0/app39VsA3z85GTMbT/tbl6LptFEMKLaN0I9?')):
        raise RuntimeError('Read URL denied')
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'}, method='POST' if data else 'GET')
    with urllib.request.build_opener(NoRedirect).open(req, timeout=60) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--complete', action='store_true')
    parser.add_argument('--airtable-lane-released', action='store_true')
    args = parser.parse_args()
    if args.complete and not args.airtable_lane_released:
        raise RuntimeError('Airtable lane release required')
    started = datetime.datetime.now(datetime.timezone.utc).isoformat()
    root = ARCHIVE / ('master-preview-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ'))
    root.mkdir(mode=0o700)
    data = {'people': table('people'), 'identities': table('identities'), 'complete': False}
    save(root / 'round2-master-db-preview-master.json', data)
    if args.complete:
        # Existing deployment credentials only; captured in memory, never logged.
        token = cli(['env', 'get', 'AUF_CANONICAL_CONTACT_READ_TOKEN']).strip()
        api_key = cli(['env', 'get', 'AIRTABLE_API_KEY']).strip()
        records, offset = [], None
        for _ in range(1000):
            params = [('pageSize', '100')] + [('fields[]', x) for x in ['Name', 'First Name', 'Last Name', 'Primary Email', 'Primary Phone']]
            if offset:
                params.append(('offset', offset))
            page = request('https://api.airtable.com/v0/app39VsA3z85GTMbT/tbl6LptFEMKLaN0I9?' + urllib.parse.urlencode(params), api_key)
            records.extend(page['records'])
            offset = page.get('offset')
            if not offset:
                break
            time.sleep(0.55)
        if offset:
            raise RuntimeError('Airtable complete-read bound exceeded')
        human_ids = list(dict.fromkeys([r['id'] for r in records] + [p['airtable_human_id'] for p in data['people'] if p.get('airtable_human_id')] + [r['source_contact_id'] for r in data['identities'] if r['source'] == 'airtable_human' and r.get('source_contact_id')]))
        snapshot = {'contacts': [], 'resolutions': []}
        for start in range(0, len(human_ids), 100):
            page = request(ENDPOINT, token, {'humanIds': human_ids[start:start + 100]})
            for key in snapshot:
                snapshot[key].extend(page[key])
        data.update(records=records, canonical=snapshot, complete=True)
        save(root / 'round2-master-db-preview-input.json', data)
    receipt = {'startedAt': started, 'finishedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'complete': data['complete'], 'people': len(data['people']), 'identities': len(data['identities']), 'records': len(data.get('records', [])), 'liveWrites': 0, 'transactionallyFrozen': False, 'candidate': subprocess.check_output(['git', 'rev-parse', 'HEAD'], text=True).strip(), 'inputSha256': hashlib.sha256(json.dumps(data, sort_keys=True).encode()).hexdigest()}
    save(root / 'round2-master-db-preview-capture-receipt.json', receipt)
    print(json.dumps({**receipt, 'archiveDirectory': str(root)}))


if __name__ == '__main__':
    try:
        main()
    except Exception:
        print('Read-only capture failed; error details withheld to avoid contact/credential output', file=sys.stderr)
        sys.exit(1)

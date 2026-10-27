"""Read-only account-wide R2 telemetry. Estimates are not a billing statement."""
import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import urllib.request

from r2_backup import ping

A = set('ListBuckets PutBucket ListObjects PutObject CopyObject CompleteMultipartUpload CreateMultipartUpload LifecycleStorageTierTransition ListMultipartUploads UploadPart UploadPartCopy ListParts PutBucketEncryption PutBucketCors PutBucketLifecycleConfiguration'.split())
B = set('HeadBucket HeadObject GetObject UsageSummary GetBucketEncryption GetBucketLocation GetBucketCors GetBucketLifecycleConfiguration'.split())
FREE = {'DeleteObject', 'DeleteBucket', 'AbortMultipartUpload'}


def query(credential, dataset, start, end):
    fields = ('sum {requests} dimensions {actionType bucketName}' if dataset == 'r2OperationsAdaptiveGroups'
              else 'max {payloadSize metadataSize objectCount} dimensions {datetime bucketName}')
    order = ',orderBy:[datetime_DESC]' if dataset == 'r2StorageAdaptiveGroups' else ''
    text = ('query($a:string!,$s:Time!,$e:Time!){viewer{accounts(filter:{accountTag:$a}){'
            + dataset + '(limit:10000,filter:{datetime_geq:$s,datetime_leq:$e}' + order
            + '){' + fields + '}}}}')
    body = json.dumps({'query': text, 'variables': {
        'a': credential['accountId'], 's': start.isoformat(), 'e': end.isoformat()}}).encode()
    request = urllib.request.Request('https://api.cloudflare.com/client/v4/graphql', data=body,
        headers={'Authorization': 'Bearer ' + credential['token'], 'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        result = json.load(response)
    if result.get('errors'):
        raise ValueError('Analytics query rejected; no valid observation produced')
    accounts = result['data']['viewer']['accounts']
    if len(accounts) != 1:
        raise ValueError('Expected exactly one authorized account')
    rows = accounts[0][dataset]
    if len(rows) >= 10000:
        raise ValueError('Possibly truncated analytics; refuse incomplete totals')
    return rows


def summarize(storage, operations, now, expected_buckets, next_backup_bytes):
    latest = {}
    for row in storage:
        d = row['dimensions']; name = d['bucketName']
        if name not in latest or d['datetime'] > latest[name]['dimensions']['datetime']:
            latest[name] = row
    if not set(expected_buckets).issubset(latest):
        raise ValueError('Expected bucket missing from analytics')
    oldest = now.timestamp()
    for row in latest.values():
        observed = dt.datetime.fromisoformat(row['dimensions']['datetime'].replace('Z', '+00:00')).timestamp()
        if not 0 <= now.timestamp() - observed <= 86400:
            raise ValueError('Storage observation stale or in future')
        oldest = min(oldest, observed)
        if any(not isinstance(v, (int, float)) or not math.isfinite(v) or v < 0 for v in row['max'].values()):
            raise ValueError('Invalid storage measurement')
    a = b = 0; unknown = {}
    for row in operations:
        action = row['dimensions']['actionType']; count = row['sum']['requests']
        if not isinstance(count, (int, float)) or not math.isfinite(count) or count < 0:
            raise ValueError('Invalid operation count')
        if action in A: a += count
        elif action in B: b += count
        elif action not in FREE:
            unknown[action] = unknown.get(action, 0) + count
            a += count  # Conservative upper bound, never silently omit unknown actions.
    size = sum(r['max']['payloadSize'] + r['max']['metadataSize'] for r in latest.values())
    forecast = size + 11 * (next_backup_bytes + 4096)
    ratio = max(forecast / 10_000_000_000, (a + 100) / 1_000_000, (b + 100) / 10_000_000)
    estimated = (math.ceil(max(0, forecast / 1e9 - 10)) * .015
                 + math.ceil(max(0, a - 1e6) / 1e6) * 4.5
                 + math.ceil(max(0, b - 1e7) / 1e6) * .36)
    return {'scope': 'all-account-r2-standard', 'observedAt': oldest,
        'collectedAt': now.timestamp(), 'storageBytes': size, 'forecastStorageBytes': forecast,
        'classA': a, 'classB': b, 'operationWindow': 'rolling-31-days',
        'unknownActionsCountedAsClassA': unknown, 'buckets': {
            name: {'observedAt': row['dimensions']['datetime'], **row['max']} for name, row in latest.items()},
        'status': 'BLOCK' if ratio >= .9 else ('WARN' if ratio >= .8 else 'OK'),
        'projectedStandardCostUSD': estimated,
        'limitations': ['Analytics may be delayed or sampled; not an exact invoice.',
            'Storage-class breakdown, contractual credits and account billing balance are not provided by this query.',
            '31-day operations are a conservative window, not the exact billing cycle.',
            'Forecast assumes current payload size; unexpected growth elsewhere cannot be prevented.']}


def main():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('--credential', type=Path, required=True)
    p.add_argument('--output', type=Path, required=True)
    p.add_argument('--expected-bucket', action='append', required=True)
    p.add_argument('--next-backup-bytes', type=int, required=True)
    p.add_argument('--failure-monitor-credential', type=Path,
                   help='Protected JSON containing backup ping URL; sends FAILURE only, never SUCCESS')
    args = p.parse_args(); os.umask(0o077)
    monitor = None
    try:
        if args.failure_monitor_credential:
            monitor = json.loads(args.failure_monitor_credential.read_text(encoding='utf-8-sig'))['backup']
        if args.next_backup_bytes <= 0: raise ValueError('Positive backup size required')
        credential = json.loads(args.credential.read_text(encoding='utf-8-sig'))
        now = dt.datetime.now(dt.timezone.utc)
        storage = query(credential, 'r2StorageAdaptiveGroups', now-dt.timedelta(days=1), now)
        operations = query(credential, 'r2OperationsAdaptiveGroups', now-dt.timedelta(days=31), now)
        result = summarize(storage, operations, now, args.expected_bucket, args.next_backup_bytes)
        temporary = args.output.with_suffix('.tmp')
        temporary.write_text(json.dumps(result, indent=2)); temporary.replace(args.output)
        if result['status'] != 'OK' and monitor:
            ping(monitor, False)
        print(json.dumps({k: result[k] for k in ('status', 'storageBytes', 'classA', 'classB', 'projectedStandardCostUSD')}))
        return 0 if result['status'] == 'OK' else 2
    except Exception:
        # Invalidate an older successful file even if it is still within 24h.
        # Missing scope/count fields force the upload budget guard to refuse it.
        try:
            temporary = args.output.with_suffix('.tmp')
            temporary.write_text(json.dumps({'status': 'FAILED'}))
            temporary.replace(args.output)
        except OSError:
            pass
        if monitor:
            try: ping(monitor, False)
            except Exception: pass
        print('R2 telemetry FAILED; no fresh observation produced; upload must fail closed')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

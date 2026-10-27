"""Verified remote retention. Default dry-run; never manages local backup files.

Requires an accepted recovery gate before deletion. Only the dedicated EU bucket
and canonical archive/receipt pairs are eligible. Server-side locks remain final.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import time

from r2_backup import BUCKET, POLICIES, retention_plan

KEY = re.compile(r'(daily|weekly)/[a-f0-9]{32}-([a-f0-9]{64})\.tar\.age')


def inventory(client, cadence, now):
    objects = {}
    for page in client.get_paginator('list_objects_v2').paginate(Bucket=BUCKET, Prefix=cadence+'/'):
        for obj in page.get('Contents', []):
            key = obj['Key']
            if key in objects: raise ValueError('Duplicate inventory key')
            objects[key] = obj
    archives = [key for key in objects if KEY.fullmatch(key)]
    expected = {k for archive in archives for k in (archive, archive+'.receipt.json')}
    if expected != set(objects): raise ValueError('Unknown or incomplete object pair; preserve everything')
    records = []
    for key in archives:
        receipt_key = key+'.receipt.json'
        response = client.get_object(Bucket=BUCKET, Key=receipt_key)
        body = response['Body']
        try: raw = body.read(16385)
        finally: body.close()
        if len(raw)>16384: raise ValueError('Oversized receipt')
        receipt = json.loads(raw)
        if (receipt.get('key') != key or receipt.get('sha256') != KEY.fullmatch(key)[2]
                or receipt.get('verification') != 'full-get-sha256'
                or receipt.get('bytes') != objects[key]['Size']):
            raise ValueError('Receipt does not identify the archive')
        if not isinstance(receipt.get('verifiedAt'), (int, float)) or not 0 <= receipt['verifiedAt'] <= now:
            raise ValueError('Invalid receipt timestamp')
        stream = client.get_object(Bucket=BUCKET, Key=key)['Body']
        h = hashlib.sha256(); size = 0
        try:
            for chunk in iter(lambda: stream.read(1024*1024), b''):
                h.update(chunk); size += len(chunk)
        finally: stream.close()
        if h.hexdigest() != receipt['sha256'] or size != receipt['bytes']:
            raise ValueError('Remote full-download verification failed; preserve everything')
        created = objects[key]['LastModified'].timestamp()
        receipt_created = objects[receipt_key]['LastModified'].timestamp()
        if max(created, receipt_created) > now: raise ValueError('Future object timestamp')
        records.append(dict(key=key, cadence=cadence, verified=True, verifiedAt=now,
                            createdAt=created, receiptCreatedAt=receipt_created))
    return records


def run(client, now, execute=False, recovery_gate=None):
    if execute and (not recovery_gate or any(recovery_gate.get(k) != 'PASS' for k in
            ('primary', 'recovery', 'postgresRestore', 'mediaSHA256', 'bucketLocks'))):
        raise ValueError('Complete real recovery acceptance required before deletion')
    plans = {}
    # Validate BOTH cadences before deleting anything.
    inventories = {c: inventory(client, c, now) for c in POLICIES}
    for cadence, records in inventories.items():
        successor = max(records, key=lambda r:r['createdAt']) if records else {}
        # Re-reading an old archive is not a new successor backup.
        if not successor or now-successor['createdAt'] > 3600:
            plans[cadence] = []
        else:
            plans[cadence] = retention_plan(records, cadence, successor, now)
    if execute:
        for cadence, keys in plans.items():
            for key in keys:
                # Fresh inventory immediately before each pair; concurrent/unknown
                # changes abort. One scheduler lock must also serialize writers.
                fresh = inventory(client, cadence, time.time())
                newest = max(fresh, key=lambda r:r['createdAt'])
                if time.time()-newest['createdAt'] > 3600 or key not in retention_plan(fresh,cadence,newest,time.time()):
                    raise ValueError('Retention preconditions changed')
                client.delete_object(Bucket=BUCKET, Key=key)
                client.delete_object(Bucket=BUCKET, Key=key+'.receipt.json')
    return {'mode': 'execute' if execute else 'dry-run', 'candidates': plans,
            'verifiedArchives': {c:len(v) for c,v in inventories.items()}, 'localDeletion': False}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--credential',type=Path,required=True)
    p.add_argument('--output',type=Path,required=True)
    p.add_argument('--execute',action='store_true')
    p.add_argument('--recovery-gate',type=Path)
    args=p.parse_args()
    try:
        import boto3
        c=json.loads(args.credential.read_text(encoding='utf-8-sig'))
        if c['bucket'] != BUCKET or not re.fullmatch(r'https://[a-f0-9]{32}\.eu\.r2\.cloudflarestorage\.com',c['endpoint']):
            raise ValueError('Wrong bucket or jurisdiction')
        client=boto3.client('s3',endpoint_url=c['endpoint'],region_name='auto',
                           aws_access_key_id=c['accessKeyId'],aws_secret_access_key=c['secretAccessKey'])
        gate=json.loads(args.recovery_gate.read_text()) if args.recovery_gate else None
        result=run(client,time.time(),args.execute,gate)
        args.output.write_text(json.dumps(result,indent=2)); print(json.dumps(result))
        return 0
    except Exception:
        print('Retention FAILED; operator review required; secrets suppressed')
        return 1


if __name__=='__main__':
    raise SystemExit(main())

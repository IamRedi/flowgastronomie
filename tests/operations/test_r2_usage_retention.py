"""Focused tests for account telemetry and retention refusal paths."""
import datetime as dt
import hashlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2]/'infra/staging'))
import r2_usage as usage
import r2_retention as retention


class UsageTests(unittest.TestCase):
    def setUp(self):
        self.now=dt.datetime(2026,10,14,12,tzinfo=dt.timezone.utc)
        self.rows=[{'dimensions':{'bucketName':n,'datetime':self.now.isoformat()},
                    'max':{'payloadSize':100,'metadataSize':10,'objectCount':2}} for n in ('flow','business')]

    def test_account_total_uses_latest_per_bucket_not_sum_of_samples(self):
        rows=self.rows+[{'dimensions':{'bucketName':'flow','datetime':'2026-10-14T11:00:00Z'},
                         'max':{'payloadSize':999,'metadataSize':10,'objectCount':2}}]
        result=usage.summarize(rows,[],self.now,['flow','business'],100)
        self.assertEqual(result['storageBytes'],220)

    def test_missing_bucket_stale_negative_and_unknown_actions(self):
        with self.assertRaises(ValueError): usage.summarize(self.rows,[],self.now,['missing'],100)
        with self.assertRaises(ValueError): usage.summarize(self.rows,[],self.now+dt.timedelta(days=2),['flow'],100)
        ops=[{'dimensions':{'actionType':'NewUnknownOperation'},'sum':{'requests':9}}]
        result=usage.summarize(self.rows,ops,self.now,['flow'],100)
        self.assertEqual(result['classA'],9)
        self.assertEqual(result['unknownActionsCountedAsClassA'],{'NewUnknownOperation':9})
        self.rows[0]['max']['payloadSize']=-1
        with self.assertRaises(ValueError): usage.summarize(self.rows,[],self.now,['flow'],100)

    def test_warning_and_block_thresholds(self):
        self.rows[0]['max']['payloadSize']=8_000_000_000
        self.assertEqual(usage.summarize(self.rows,[],self.now,['flow'],100)['status'],'WARN')
        self.rows[0]['max']['payloadSize']=9_000_000_000
        self.assertEqual(usage.summarize(self.rows,[],self.now,['flow'],100)['status'],'BLOCK')


class FakeS3:
    def __init__(self,now,cadence='daily',count=9,spacing=86400):
        self.data={};self.meta={};self.deleted=[]
        for i in range(count):
            payload=('synthetic cipher '+str(i)).encode();sha=hashlib.sha256(payload).hexdigest()
            key=f'{cadence}/{i:032x}-{sha}.tar.age'; created=now-i*spacing
            receipt=json.dumps({'key':key,'sha256':sha,'bytes':len(payload),'verifiedAt':created,
                                'verification':'full-get-sha256'}).encode()
            for k,b,t in ((key,payload,created),(key+'.receipt.json',receipt,created+60 if i else created)):
                self.data[k]=b;self.meta[k]={'Key':k,'Size':len(b),'LastModified':dt.datetime.fromtimestamp(t,dt.timezone.utc)}
    def get_paginator(self,name):return self
    def paginate(self,**kwargs):yield {'Contents':[v for k,v in self.meta.items() if k.startswith(kwargs['Prefix'])]}
    def get_object(self,**kwargs):return {'Body':io.BytesIO(self.data[kwargs['Key']])}
    def delete_object(self,**kwargs):self.deleted.append(kwargs['Key'])


class RetentionTests(unittest.TestCase):
    def test_dry_run_preserves_late_receipt_lock_and_every_object(self):
        client=FakeS3(2_000_000)
        result=retention.run(client,2_000_000)
        self.assertEqual(len(result['candidates']['daily']),1)
        self.assertTrue(result['candidates']['daily'][0].startswith('daily/'+f'{8:032x}'))
        self.assertEqual(client.deleted,[])

    def test_weekly_28_day_protection(self):
        client=FakeS3(4_000_000,'weekly',6,7*86400)
        result=retention.run(client,4_000_000)
        self.assertEqual(len(result['candidates']['weekly']),1)
        self.assertTrue(result['candidates']['weekly'][0].startswith('weekly/'+f'{5:032x}'))

    def test_corrupt_or_incomplete_remote_refuses_all_deletion(self):
        client=FakeS3(2_000_000)
        client.data[next(iter(client.data))]=b'corrupt'
        with self.assertRaises(ValueError):retention.run(client,2_000_000)
        self.assertEqual(client.deleted,[])
        client=FakeS3(2_000_000); client.meta.pop(next(k for k in client.meta if k.endswith('.json')))
        with self.assertRaises(ValueError):retention.run(client,2_000_000)
        self.assertEqual(client.deleted,[])

    def test_old_successor_and_missing_real_acceptance_never_delete(self):
        client=FakeS3(2_000_000)
        self.assertEqual(retention.run(client,2_003_601)['candidates']['daily'],[])
        with self.assertRaises(ValueError):retention.run(client,2_000_000,execute=True,recovery_gate={})
        self.assertEqual(client.deleted,[])

    def test_execute_only_expired_pair_with_complete_recovery_gate(self):
        client=FakeS3(2_000_000)
        gate={k:'PASS' for k in ('primary','recovery','postgresRestore','mediaSHA256','bucketLocks')}
        with patch.object(retention.time,'time',return_value=2_000_000):
            result=retention.run(client,2_000_000,execute=True,recovery_gate=gate)
        key=result['candidates']['daily'][0]
        self.assertEqual(client.deleted,[key,key+'.receipt.json'])

    def test_app_image_is_independent_but_bucket_locks_are_required(self):
        gate={k:'PASS' for k in ('primary','recovery','postgresRestore','mediaSHA256','bucketLocks')}
        gate['exactImageReadiness']='BLOCKED'
        client=FakeS3(2_000_000)
        with patch.object(retention.time,'time',return_value=2_000_000):
            retention.run(client,2_000_000,True,gate)
        self.assertEqual(len(client.deleted),2)
        gate['bucketLocks']='UNKNOWN'
        client=FakeS3(2_000_000)
        with self.assertRaises(ValueError): retention.run(client,2_000_000,True,gate)
        self.assertEqual(client.deleted,[])

    def test_corrupt_weekly_prevents_even_valid_daily_deletion(self):
        client=FakeS3(4_000_000)
        weekly=FakeS3(4_000_000,'weekly',6,7*86400)
        client.meta.update(weekly.meta);client.data.update(weekly.data)
        client.data[next(iter(weekly.data))]=b'bad'
        gate={k:'PASS' for k in ('primary','recovery','postgresRestore','mediaSHA256','bucketLocks')}
        with self.assertRaises(ValueError):retention.run(client,4_000_000,True,gate)
        self.assertEqual(client.deleted,[])


if __name__=='__main__':unittest.main()

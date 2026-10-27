import importlib.util,tempfile,pathlib,unittest,zipfile,json,hashlib
spec=importlib.util.spec_from_file_location('evidence',pathlib.Path(__file__).resolve().parents[2]/'infra/ci/preserve-evidence.py');mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class EvidenceTests(unittest.TestCase):
 def test_self_hosted_keeps_full_allowlist_locally_and_only_json_in_cloud(self):
  with tempfile.TemporaryDirectory() as t:
   r=pathlib.Path(t);w=r/'workspace';(w/'artifacts').mkdir(parents=True)
   for name,data in [('result.json','{"passed":true}'),('screenshot.png','synthetic-image'),('private.env','PRIVATE')]: (w/'artifacts'/name).write_text(data)
   result=mod.preserve(w,['artifacts/result.json','artifacts/screenshot.png'],r/'upload',r/'archive','42-1-verify',True)
   self.assertFalse((r/'upload/artifacts/screenshot.png').exists());self.assertTrue((r/'upload/artifacts/result.json').exists())
   archive=r/'archive'/result['archive']['name'];self.assertEqual(result['archive']['sha256'],hashlib.sha256(archive.read_bytes()).hexdigest())
   local_index=json.loads((r/'archive/run-42-1-verify.index.json').read_text())
   self.assertEqual(local_index,result)
   with zipfile.ZipFile(archive) as z:self.assertEqual(set(z.namelist()),{'artifacts/result.json','artifacts/screenshot.png'})
 def test_hosted_keeps_existing_cloud_evidence_contract(self):
  with tempfile.TemporaryDirectory() as t:
   r=pathlib.Path(t);(r/'artifacts').mkdir();(r/'artifacts/a.png').write_bytes(b'image')
   mod.preserve(r,['artifacts/*.png'],r/'upload',r/'archive','42-1-verify',False)
   self.assertEqual((r/'upload/artifacts/a.png').read_bytes(),b'image');self.assertFalse((r/'archive').exists())
 def test_outside_pattern_and_existing_destination_fail_closed(self):
  with tempfile.TemporaryDirectory() as t:
   r=pathlib.Path(t)
   with self.assertRaises(ValueError):mod.collect(r,['../private'])
   (r/'upload').mkdir()
   with self.assertRaises(ValueError):mod.preserve(r,[],r/'upload',r/'archive','42-1-verify',True)
 def test_symlink_cannot_exfiltrate_private_file(self):
  with tempfile.TemporaryDirectory() as t:
   r=pathlib.Path(t);(r/'artifacts').mkdir();(r/'private').write_text('PRIVATE')
   try:(r/'artifacts/out.json').symlink_to(r/'private')
   except OSError:self.skipTest('OS does not permit this user to create symlinks')
   with self.assertRaises(ValueError):mod.collect(r,['artifacts/*.json'])
if __name__=='__main__':unittest.main()

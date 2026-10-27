#!/usr/bin/env python3
"""Preserve the workflow's existing allowlist; self-hosted uploads JSON only."""
import argparse,glob,hashlib,json,os,pathlib,shutil,time,zipfile

def digest(path):
    with path.open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()

def collect(workspace, patterns):
    workspace=pathlib.Path(workspace).resolve();found={}
    for pattern in patterns:
        if not pattern.startswith('artifacts/') or '..' in pathlib.PurePosixPath(pattern).parts:
            raise ValueError('Evidence pattern is outside the reviewed artifacts boundary')
        for match in glob.glob(str(workspace/pattern),recursive=True):
            p=pathlib.Path(match)
            if p.is_dir():
                candidates=p.rglob('*')
            else:candidates=[p]
            for f in candidates:
                if not f.is_file():continue
                if f.is_symlink() or not f.resolve().is_relative_to(workspace/'artifacts'):
                    raise ValueError('Evidence symlink or path escape refused')
                found[f.relative_to(workspace).as_posix()]=f
    return found

def preserve(workspace,patterns,upload,archive_root,run_key,self_hosted):
    workspace=pathlib.Path(workspace).resolve();upload=pathlib.Path(upload)
    if upload.exists():raise ValueError('Fresh upload directory required')
    files=collect(workspace,patterns);upload.mkdir(parents=True,mode=0o700)
    if sum(p.stat().st_size for p in files.values())>1024**3:raise ValueError('Evidence exceeds1GiB local archive budget')
    index={'schema':'flow.ci-evidence.v1','files':[],'fullEvidenceLocal':self_hosted}
    if self_hosted:
        archive_root=pathlib.Path(archive_root);archive_root.mkdir(parents=True,exist_ok=True,mode=0o700)
        archive=archive_root/('run-'+run_key+'.zip')
        if archive.exists():raise ValueError('Existing evidence archive must not be overwritten')
        with zipfile.ZipFile(archive,'x',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
            for name,p in sorted(files.items()):z.write(p,name)
        archive.chmod(0o600)
        index['archive']={'name':archive.name,'sha256':digest(archive),'bytes':archive.stat().st_size}
    uploaded_bytes=0
    for name,p in sorted(files.items()):
        index['files'].append({'path':name,'bytes':p.stat().st_size,'sha256':digest(p)})
        if not self_hosted or p.suffix=='.json':
            uploaded_bytes+=p.stat().st_size
            if self_hosted and uploaded_bytes>20*1024*1024:raise ValueError('JSON upload exceeds20MiB budget; full local archive retained')
            dest=upload/name;dest.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(p,dest)
    encoded=json.dumps(index,indent=2)+'\n'
    if self_hosted:
        local_index=archive_root/('run-'+run_key+'.index.json')
        with local_index.open('x') as f:f.write(encoded)
        local_index.chmod(0o600)
    (upload/'ci-evidence-index.json').write_text(encoded)
    return index

if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--job',choices=['verify','lab1'],required=True);a=p.parse_args()
    patterns=json.loads(pathlib.Path('infra/ci/evidence-paths.json').read_text())[a.job]
    run_key='-'.join([os.environ['GITHUB_RUN_ID'],os.environ.get('GITHUB_RUN_ATTEMPT','1'),a.job])
    if any(not(part.isdigit()) for part in run_key.split('-')[:2]):raise ValueError('Run identity invalid')
    upload=pathlib.Path(os.environ['RUNNER_TEMP'])/('flow-evidence-'+run_key)
    index=preserve(os.environ['GITHUB_WORKSPACE'],patterns,upload,pathlib.Path.home()/'ci-evidence',run_key,os.environ.get('RUNNER_ENVIRONMENT')=='self-hosted')
    with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('directory='+str(upload)+'\n')
    if os.environ.get('GITHUB_STEP_SUMMARY'):
        with open(os.environ['GITHUB_STEP_SUMMARY'],'a') as f:
            f.write('### Sanitized CI evidence\n\nCaptured files: '+str(len(index['files']))+'\n\n')
            if index.get('archive'):
                a=index['archive'];f.write('Owner-only local archive: `'+a['name']+'`\n\nSHA256: `'+a['sha256']+'`\n\nBytes: '+str(a['bytes'])+'\n\n')
            f.write('Cloud publication is optional on self-hosted runs; all test gates and local evidence preservation remain mandatory.\n')
    print(json.dumps({'capturedFiles':len(index['files']),'fullEvidenceLocal':index['fullEvidenceLocal'],'archive':index.get('archive')}))

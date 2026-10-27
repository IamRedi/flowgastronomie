"""Transactional edge adoption; candidate nginx is checked before recreation."""
import hashlib
import http.client
import json
import os
from pathlib import Path
import socket
import ssl
import subprocess
import sys
import time
import uuid

STATE = Path("/etc/flowgastronomie/shared-edge")
BASE = Path("/opt/flowgastronomie/current")
EDGE = "flowgastronomie-proxy-1"
HOSTS = ["123serve.de", "www.123serve.de", "api.123serve.de",
         "staging.123serve.de", "staging-api.123serve.de",
         "businesssiterc.de", "www.businesssiterc.de", "control.businesssiterc.de",
         "mhaziri.de", "www.mhaziri.de", "infoesence.com", "www.infoesence.com"]


def run(args):
    r = subprocess.run(args, capture_output=True, text=True, timeout=90)
    if r.returncode:
        raise RuntimeError("EDGE_COMMAND_FAILED")
    return r.stdout


def snapshot(d):
    """Only this public edge; exclude all application/env/DB definitions."""
    if d["Name"] != "/" + EDGE or d["Config"]["Labels"].get("com.docker.compose.service") != "proxy":
        raise RuntimeError("EDGE_IDENTITY_REFUSED")
    h, c = d["HostConfig"], d["Config"]
    if h["Privileged"] or h.get("CapAdd") or h.get("Devices"):
        raise RuntimeError("UNSUPPORTED_EDGE_PRIVILEGE")
    allowed = {"PATH", "NGINX_VERSION", "NJS_VERSION", "NJS_RELEASE", "PKG_RELEASE", "DYNPKG_RELEASE",
               "ACME_VERSION", "WEB_HOST", "API_HOST", "NGINX_ENVSUBST_FILTER"}
    if any(x.split("=", 1)[0] not in allowed for x in c["Env"]):
        raise RuntimeError("UNEXPECTED_EDGE_ENVIRONMENT")
    if any(m["Type"] != "bind" for m in d["Mounts"]):
        raise RuntimeError("UNSUPPORTED_EDGE_MOUNT")
    networks = d["NetworkSettings"]["Networks"]
    if any("businesssite_target_internal" in n for n in networks):
        raise RuntimeError("EDGE_DATABASE_NETWORK_REFUSED")
    service = {
        "image": d["Image"], "pull_policy": "never", "container_name": EDGE,
        "user": c["User"], "entrypoint": c["Entrypoint"], "command": c["Cmd"],
        "environment": c["Env"], "read_only": h["ReadonlyRootfs"],
        "restart": h["RestartPolicy"]["Name"], "init": h.get("Init", False),
        "cap_drop": h.get("CapDrop") or [], "security_opt": h.get("SecurityOpt") or [],
        "logging": {"driver": h["LogConfig"]["Type"], "options": h["LogConfig"].get("Config", {})},
        "volumes": [{"type": "bind", "source": m["Source"], "target": m["Destination"],
                     "read_only": not m["RW"], "bind": {"create_host_path": False}} for m in d["Mounts"]],
        "tmpfs": [p + ":" + options for p, options in (h.get("Tmpfs") or {}).items()],
        "ports": [{"target": int(port.split("/")[0]), "published": item["HostPort"],
                   "host_ip": item["HostIp"], "protocol": port.split("/")[1]}
                  for port, bindings in d["NetworkSettings"]["Ports"].items() for item in (bindings or [])],
        # Docker-assigned addresses can be reused by another container while
        # the edge is replaced. Preserve only explicitly configured IPAM.
        "networks": {n: {
            **({"ipv4_address": v["IPAMConfig"]["IPv4Address"]}
               if (v.get("IPAMConfig") or {}).get("IPv4Address") else {}),
            **({"aliases": [a for a in (v.get("Aliases") or []) if a != d["Id"][:12]]}
               if v.get("Aliases") else {}),
        } for n, v in networks.items()},
    }
    health = c.get("Healthcheck")
    if health:
        service["healthcheck"] = {"test": health["Test"],
            **{key: str(health[old]) + "ns" for key, old in
               [("interval", "Interval"), ("timeout", "Timeout"), ("start_period", "StartPeriod")]
               if health.get(old)}, "retries": health.get("Retries", 3)}
    if h.get("Memory"):
        service.update(mem_limit=h["Memory"], memswap_limit=h["MemorySwap"])
    if h.get("NanoCpus"):
        service["cpus"] = str(h["NanoCpus"] / 1e9)
    if h.get("PidsLimit"):
        service["pids_limit"] = h["PidsLimit"]
    return {"name": "flowgastronomie", "services": {"proxy": service},
            "networks": {n: {"external": True, "name": n} for n in networks}}


def route_path(host):
    return "/health" if host in ("api.123serve.de", "staging-api.123serve.de") else (
        "/owner/login" if host.startswith("control.") else "/")


def routes():
    result = {}
    for host in HOSTS:
        path = route_path(host)
        sock = ssl.create_default_context().wrap_socket(
            socket.create_connection(("127.0.0.1", 443), timeout=5), server_hostname=host)
        try:
            sock.sendall(f"GET {path} HTTP/1.1\r\nHost: {host}\r\nConnection: close\r\n\r\n".encode())
            r = http.client.HTTPResponse(sock)
            r.begin()
            r.read(1024)
            if r.status >= 500:
                raise RuntimeError("EDGE_ROUTE_UNAVAILABLE")
            result[host] = {"status": r.status, "location": r.getheader("Location")}
        finally:
            sock.close()
    return result


def transaction(validate, capture, apply, verify, restore):
    validate()  # Crucially BEFORE replacing the only public edge.
    before = capture()
    try:
        apply()
        verify(before)
    except Exception:
        restore()
        verify(before)
        raise


def adoption_identity(candidate, current, candidate_template, current_template):
    # This operator adopts persistent mounts; it is not an image/template
    # upgrade path. That requires its own exact candidate validation.
    if candidate["services"]["proxy"]["image"] != current["Image"]:
        raise RuntimeError("ADOPTION_IMAGE_CHANGED")
    if candidate_template != current_template:
        raise RuntimeError("ADOPTION_STAGING_TEMPLATE_CHANGED")
    current_env = dict(x.split("=", 1) for x in current["Config"]["Env"])
    candidate_env = candidate["services"]["proxy"].get("environment") or {}
    for key in ("WEB_HOST", "API_HOST", "NGINX_ENVSUBST_FILTER"):
        # Compose config serializes literal dollars as $$ so its output can be
        # consumed again. Inspect reports the single-dollar container value.
        value = candidate_env.get(key)
        if isinstance(value, str):
            value = value.replace("$$", "$")
        if value != current_env.get(key):
            raise RuntimeError("ADOPTION_RENDER_ENVIRONMENT_CHANGED")


def validate_nginx(d, flow_config, business_config, staging_config):
    run(["docker", "run", "--rm", "--network", "container:" + EDGE,
         "--user", d["Config"]["User"], "--read-only", "--cap-drop", "ALL", "--cap-add", "CHOWN",
         "--security-opt", "no-new-privileges:true", "--memory", "128m",
         "--memory-swap", "128m", "--cpus", "0.25", "--pids-limit", "64",
         "--volumes-from", EDGE + ":ro", "--tmpfs", "/tmp:rw,nosuid,nodev,size=16m",
         "--tmpfs", "/var/run:rw,nosuid,nodev,size=1m",
         "--tmpfs", "/var/cache/nginx:rw,nosuid,nodev,size=16m",
         "--mount", "type=bind,src=" + str(flow_config) + ",dst=/etc/nginx/conf.d/public.conf,readonly",
         "--mount", "type=bind,src=" + str(business_config) + ",dst=/etc/nginx/conf.d/businesssite.conf,readonly",
         "--mount", "type=bind,src=" + str(staging_config) + ",dst=/etc/nginx/conf.d/default.conf,readonly",
         "--entrypoint", "nginx", d["Image"], "-t"])


def main():
    if os.geteuid() != 0 or sys.argv[1:] not in [["validate"], ["recreate"]]:
        raise RuntimeError("ROOT_EXACT_ACTION_REQUIRED")
    import fcntl
    os.umask(0o077)
    with open("/run/lock/flowgastronomie-shared-edge.lock", "w") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        d = json.loads(run(["docker", "inspect", EDGE]))[0]
        previous = snapshot(d)
        env = os.environ
        env["PUBLIC_EDGE_CONFIG"] = str(STATE / "flow-public.conf")
        env["STAGING_EDGE_TEMPLATE"] = str(STATE / "staging-template.conf")
        cmd = ["docker", "compose", "--project-directory", str(BASE), "-p", "flowgastronomie",
               "--env-file", "/etc/flowgastronomie/production.env",
               "-f", str(BASE / "compose.production.yaml"), "-f", str(BASE / "compose.staging.yaml")]
        for file in ["public-edge.compose.yaml", "edge-image.compose.yaml", "shared-edge.compose.yaml"]:
            cmd += ["-f", str(STATE / file)]
        def validate():
            run(cmd + ["config", "--quiet"])
            candidate = json.loads(run(cmd + ["config", "--format", "json"]))
            current_template_path = next(m["Source"] for m in d["Mounts"]
                if m["Destination"] == "/etc/nginx/templates/default.conf.template")
            adoption_identity(candidate, d, (STATE / "staging-template.conf").read_bytes(),
                              Path(current_template_path).read_bytes())
            # The existing entrypoint rendered this staging file into its
            # writable layer, so --volumes-from alone would omit it.
            rendered = STATE / ("validate-staging-" + uuid.uuid4().hex + ".conf")
            rendered.write_text(run(["docker", "exec", EDGE, "cat", "/etc/nginx/conf.d/default.conf"]))
            # Existing templates/certificates remain mounted from the current
            # edge; override only the two already-rendered public files.
            validate_nginx(d, STATE / "flow-public.conf", STATE / "businesssite.conf", rendered)
        if sys.argv[1] == "validate":
            validate()
            print("PASS_SHARED_EDGE_CANDIDATE_NGINX")
            return
        backup = STATE / ("rollback-" + uuid.uuid4().hex + ".json")
        with backup.open("x") as f:
            json.dump(previous, f)
            f.flush()
            os.fsync(f.fileno())
        def apply():
            run(cmd + ["up", "-d", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", "proxy"])
        def verify(before):
            run(["docker", "exec", EDGE, "nginx", "-t"])
            for _ in range(10):
                try:
                    if routes() == before:
                        return
                except Exception:
                    pass
                time.sleep(1)
            raise RuntimeError("EDGE_ROUTES_CHANGED")
        def restore():
            run(["docker", "compose", "-p", "flowgastronomie", "-f", str(backup),
                 "up", "-d", "--no-deps", "--no-build", "--pull", "never", "--force-recreate", "proxy"])
        transaction(validate, routes, apply, verify, restore)
        print("PASS_SHARED_EDGE_RECREATION_AND_BOTH_PLATFORM_ROUTES")


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print("SHARED_EDGE_FAILED; retained rollback requires inspection", file=sys.stderr)
        raise SystemExit(1)

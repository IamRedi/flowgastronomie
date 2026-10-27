import importlib.util
import pathlib
import unittest

path = pathlib.Path(__file__).resolve().parents[2] / "infra/production/shared-edge-transaction.py"
spec = importlib.util.spec_from_file_location("edge_transaction", path)
edge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(edge)


class AtomicEdge(unittest.TestCase):
    def test_compose_literal_dollar_serialization_preserves_runtime_identity(self):
        runtime = "^(WEB_HOST|API_HOST)$"
        current = {"Image": "sha256:exact", "Config": {"Env": [
            "WEB_HOST=staging.example", "API_HOST=api.example",
            "NGINX_ENVSUBST_FILTER=" + runtime]}}
        env = {"WEB_HOST": "staging.example", "API_HOST": "api.example",
               "NGINX_ENVSUBST_FILTER": runtime.replace("$", "$$")}
        candidate = {"services": {"proxy": {"image": "sha256:exact", "environment": env}}}
        edge.adoption_identity(candidate, current, b"same", b"same")
        for key, wrong in (("WEB_HOST", "other.example"), ("API_HOST", "other.example"),
                           ("NGINX_ENVSUBST_FILTER", "^(OTHER)$$"),
                           ("NGINX_ENVSUBST_FILTER", runtime + "$$$")):
            with self.subTest(key=key, wrong=wrong):
                changed = {"services": {"proxy": {"image": "sha256:exact", "environment": env | {key: wrong}}}}
                with self.assertRaisesRegex(RuntimeError, "RENDER_ENVIRONMENT_CHANGED"):
                    edge.adoption_identity(changed, current, b"same", b"same")

    def test_real_staging_api_uses_health_in_adoption_and_rollback(self):
        self.assertIn("staging-api.123serve.de", edge.HOSTS)
        self.assertNotIn("api.staging.123serve.de", edge.HOSTS)
        self.assertEqual(edge.route_path("staging-api.123serve.de"), "/health")
        self.assertEqual(edge.route_path("api.123serve.de"), "/health")
        self.assertEqual(edge.route_path("control.businesssiterc.de"), "/owner/login")
        self.assertEqual(edge.route_path("staging.123serve.de"), "/")

    def test_adoption_cannot_validate_one_image_or_template_and_apply_another(self):
        candidate = {"services": {"proxy": {"image": "sha256:exact"}}}
        current = {"Image": "sha256:exact", "Config": {"Env": []}}
        edge.adoption_identity(candidate, current, b"same", b"same")
        with self.assertRaises(RuntimeError):
            edge.adoption_identity(candidate, {"Image": "sha256:other"}, b"same", b"same")
        with self.assertRaises(RuntimeError):
            edge.adoption_identity(candidate, current, b"invalid new", b"old")
        candidate["services"]["proxy"]["environment"] = {"WEB_HOST": "changed"}
        with self.assertRaisesRegex(RuntimeError, "RENDER_ENVIRONMENT_CHANGED"):
            edge.adoption_identity(candidate, current, b"same", b"same")

    def test_invalid_candidate_never_touches_live_edge(self):
        calls = []
        def bad():
            calls.append("validate")
            raise RuntimeError("bad nginx")
        with self.assertRaises(RuntimeError):
            edge.transaction(bad, lambda: calls.append("capture"), lambda: calls.append("apply"),
                             lambda before: calls.append("verify"), lambda: calls.append("restore"))
        self.assertEqual(calls, ["validate"])

    def test_failed_recreation_restores_then_checks_both_platforms(self):
        calls = []
        def apply():
            calls.append("apply")
            raise RuntimeError("start failed")
        with self.assertRaises(RuntimeError):
            edge.transaction(lambda: calls.append("validate"), lambda: {"both": "before"}, apply,
                             lambda before: calls.append(("verify", before)), lambda: calls.append("restore"))
        self.assertEqual(calls, ["validate", "apply", "restore", ("verify", {"both": "before"})])

    def test_bad_route_restores_and_successful_candidate_does_not(self):
        calls = []
        count = 0
        def verify(before):
            nonlocal count
            count += 1
            calls.append("verify")
            if count == 1:
                raise RuntimeError("host lost")
        with self.assertRaises(RuntimeError):
            edge.transaction(lambda: calls.append("validate"), lambda: {}, lambda: calls.append("apply"),
                             verify, lambda: calls.append("restore"))
        self.assertEqual(calls, ["validate", "apply", "verify", "restore", "verify"])
        calls.clear()
        edge.transaction(lambda: calls.append("validate"), lambda: {}, lambda: calls.append("apply"),
                         lambda before: calls.append("verify"), lambda: calls.append("restore"))
        self.assertEqual(calls, ["validate", "apply", "verify"])


if __name__ == "__main__":
    unittest.main()

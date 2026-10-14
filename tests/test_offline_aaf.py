"""Portable control-flow tests; the real Windows build validates actual wheels."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location("offline_aaf", Path(__file__).parents[1] / "scripts/offline_aaf.py")
aaf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(aaf)


class OfflineBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="offline bundle ")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / "package"
        self.root.mkdir()
        for relative, _ in aaf.PROJECTS:
            project = self.root / relative
            (project / "src").mkdir(parents=True)
            (project / "pyproject.toml").write_text("[project]\nname='fixture'\n")
            (project / "src/example.py").write_text("value = 1\n")
        path = self.root / "toolkit-workbench/api/requirements.txt"
        path.parent.mkdir(parents=True)
        path.write_text("fixture==1\n")
        self.target = self.root / "vendor/aaf"
        files = {}
        for group in aaf.GROUPS:
            wheels = self.target / group / "wheels"
            wheels.mkdir(parents=True)
            wheel = wheels / "fixture-1-py3-none-any.whl"
            wheel.write_bytes(b"fixture wheel")
            lock = wheels.parent / "requirements.lock"
            lock.write_text("fixture==1\n")
            for file in (wheel, lock):
                files[file.relative_to(self.target).as_posix()] = aaf.digest(file)
        self.manifest = {"schema": aaf.SCHEMA, "target": aaf.fingerprint(), "files": files, "sources": aaf.sources(self.root)}
        self.write_manifest()

    def write_manifest(self):
        content = {k: v for k, v in self.manifest.items() if k != "bundle_id"}
        self.manifest["bundle_id"] = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()
        (self.target / "manifest.json").write_text(json.dumps(self.manifest))

    def test_missing_or_corrupted_wheel_is_rejected_before_install(self):
        file = next(self.target.rglob("*.whl"))
        file.write_bytes(b"truncated")
        with self.assertRaisesRegex(RuntimeError, "Missing or changed"):
            aaf.verified_manifest(self.root)
        file.unlink()
        with self.assertRaisesRegex(RuntimeError, "Missing or changed"):
            aaf.verified_manifest(self.root)

    def test_valid_bundle_and_target_mismatch(self):
        self.assertEqual(aaf.verified_manifest(self.root)[1], self.manifest)
        self.manifest["target"]["python"] = "0.0"
        self.write_manifest()
        # Points at rebuilding on the packaging side, not installing a
        # different Python here - a locked-down recipient machine usually
        # can't install one anyway, and wheels aren't ABI-portable across
        # CPython minor versions regardless.
        with self.assertRaisesRegex(RuntimeError, "rebuild with a Python"):
            aaf.verified_manifest(self.root)

    def test_extra_source_or_wheel_is_not_silently_used(self):
        extra = self.root / aaf.PROJECTS[0][0] / "src/new.py"
        extra.write_text("changed=True")
        with self.assertRaisesRegex(RuntimeError, "unexpected wheel set"):
            aaf.verified_manifest(self.root)
        extra.unlink()
        (self.target / "capabilities/wheels/extra.whl").write_bytes(b"extra")
        with self.assertRaisesRegex(RuntimeError, "unexpected wheel set"):
            aaf.verified_manifest(self.root)

    def test_offline_environment_handles_spaces_and_disables_both_resolvers(self):
        env = aaf.offline_env(self.target / "capabilities/wheels", self.target / "capabilities/requirements.lock")
        self.assertEqual(env["PIP_NO_INDEX"], "1")
        self.assertEqual(env["UV_OFFLINE"], "true")
        self.assertEqual(env["UV_PYTHON_DOWNLOADS"], "never")
        self.assertIn("%20", env["PIP_FIND_LINKS"])
        self.assertEqual(env["UV_FIND_LINKS"], env["PIP_FIND_LINKS"])

    def prepare_patches(self):
        return (patch.object(aaf, "require_windows"), patch.object(Path, "home", return_value=Path(self.temp.name)/"user"),
                patch.object(aaf.venv, "create", side_effect=lambda path, **kwargs: (path / "Scripts").mkdir(parents=True)),
                patch.object(aaf, "run"), patch.object(aaf, "validate_runtime"))

    def test_fresh_install_repeat_and_broken_existing_environment(self):
        windows, home, create, run, validate = self.prepare_patches()
        with windows, home, create as made, run as called, validate as checked:
            env_file = self.root / ".tmp/offline.cmd"
            aaf.prepare(self.root, env_file)
            self.assertEqual(made.call_count, 4)
            commands = [list(map(str, c.args[0])) for c in called.call_args_list]
            self.assertTrue(all("--no-index" in args for args in commands))
            self.assertTrue(all(c.kwargs["env"]["UV_OFFLINE"] == "true" for c in called.call_args_list))
            text = env_file.read_text()
            self.assertIn("PIP_FIND_LINKS=file://", text)
            self.assertIn("%%20", text)  # cmd escaping preserves URI-encoded spaces
            made.reset_mock(); called.reset_mock()
            aaf.prepare(self.root, env_file)
            made.assert_not_called(); called.assert_not_called()
            # Exactly the screenshot's category: a directory exists but the
            # interpreter/import health check fails. It must be rebuilt.
            checked.side_effect = [RuntimeError("broken"), None, None, None, None]
            aaf.prepare(self.root, env_file)
            self.assertEqual(made.call_count, 1)
            self.assertTrue(list((Path(self.temp.name)/"user").rglob("framework.failed-*")))

    def test_failed_install_does_not_write_ready_marker_or_launcher_env(self):
        windows, home, create, run, validate = self.prepare_patches()
        with windows, home, create, run as called, validate:
            called.side_effect = subprocess.CalledProcessError(1, "pip")
            env_file = self.root / "offline.cmd"
            with self.assertRaises(subprocess.CalledProcessError):
                aaf.prepare(self.root, env_file)
            self.assertFalse(env_file.exists())
            self.assertFalse(list((Path(self.temp.name)/"user").rglob(".ready")))

    def test_moving_extracted_package_reuses_the_same_runtime_paths(self):
        # A fresh pack/unzip/unpack cycle lands at a new extraction path
        # every time (a dated folder, a Windows "(2)" suffix on a duplicate
        # download) - if that alone forced a new runtime path, every cycle
        # would pay for a full reinstall even when nothing actually
        # changed. stabilize_project_sources gives the editable-installed
        # project sources one fixed, permanent home so this can't happen.
        windows, home, create, run, validate = self.prepare_patches()
        with windows, home, create as made, run, validate:
            aaf.prepare(self.root)
            self.assertEqual(made.call_count, 4)
            moved = self.root.with_name("relocated package")
            self.root.rename(moved)
            made.reset_mock()
            aaf.prepare(moved)
            made.assert_not_called()

    def test_stabilize_project_sources_mirrors_and_refreshes(self):
        with patch.object(Path, "home", return_value=Path(self.temp.name) / "user"):
            stable_root = aaf.stabilize_project_sources(self.root)
            relative = aaf.PROJECTS[0][0]
            mirrored = stable_root / relative / "src/example.py"
            self.assertEqual(mirrored.read_text(), "value = 1\n")
            # A later edit to the real source must still reach the mirror -
            # this is a live copy refreshed on every call, not a one-time
            # snapshot that would otherwise go stale.
            (self.root / relative / "src/example.py").write_text("value = 2\n")
            aaf.stabilize_project_sources(self.root)
            self.assertEqual(mirrored.read_text(), "value = 2\n")

    # --- build-time cache: rebuilding is expensive, but AAF/toolkit updates
    # are rare, so most pack.ps1 runs should reuse a prior build instead. ---

    def cache_manifest_and_files(self, cache):
        """A valid, matching-recipe cache manifest + real wheel/lock files
        under `cache`, mirroring setUp's own `self.target` fixture but at
        the persistent cache location instead of a one-run staging dir."""
        files = {}
        for group in aaf.GROUPS:
            wheels = cache / group / "wheels"
            wheels.mkdir(parents=True)
            wheel = wheels / "fixture-1-py3-none-any.whl"
            wheel.write_bytes(b"fixture wheel")
            lock = wheels.parent / "requirements.lock"
            lock.write_text("fixture==1\n")
            for file in (wheel, lock):
                files[file.relative_to(cache).as_posix()] = aaf.digest(file)
        manifest = {"schema": aaf.SCHEMA, "target": aaf.fingerprint(), "recipe": aaf.build_recipe_digest(),
                    "files": files, "sources": aaf.sources(self.root)}
        content = {k: v for k, v in manifest.items() if k != "bundle_id"}
        manifest["bundle_id"] = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()
        (cache / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
        return manifest

    def test_cache_hit_copies_a_matching_bundle_into_a_fresh_target(self):
        with patch.object(Path, "home", return_value=Path(self.temp.name) / "user"):
            self.cache_manifest_and_files(aaf.cache_dir())
            target = self.root / "fresh-target"
            self.assertTrue(aaf.try_reuse_cached_bundle(self.root, target))
            self.assertTrue((target / "framework/wheels/fixture-1-py3-none-any.whl").is_file())
            self.assertTrue((target / "manifest.json").is_file())

    def test_cache_miss_when_there_is_no_cache_yet(self):
        with patch.object(Path, "home", return_value=Path(self.temp.name) / "user-with-no-cache"):
            self.assertFalse(aaf.try_reuse_cached_bundle(self.root, self.root / "fresh-target"))

    def test_cache_miss_on_corrupted_manifest_falls_through_rather_than_raising(self):
        with patch.object(Path, "home", return_value=Path(self.temp.name) / "user"):
            cache = aaf.cache_dir()
            cache.mkdir(parents=True)
            (cache / "manifest.json").write_text("not json{{{")
            self.assertFalse(aaf.try_reuse_cached_bundle(self.root, self.root / "fresh-target"))

    def test_cache_miss_on_recipe_mismatch(self):
        # Simulates this script's own build recipe changing (a new GROUP, a
        # bumped version constraint) - sources(root) alone can't see that,
        # this is the check that has to catch it. bundle_id is recomputed
        # over the mutated recipe so this is isolated from manifest_intact -
        # an internally-consistent manifest can still be a stale recipe.
        with patch.object(Path, "home", return_value=Path(self.temp.name) / "user"):
            cache = aaf.cache_dir()
            manifest = self.cache_manifest_and_files(cache)
            manifest["recipe"] = "stale-recipe-digest"
            content = {k: v for k, v in manifest.items() if k != "bundle_id"}
            manifest["bundle_id"] = hashlib.sha256(json.dumps(content, sort_keys=True).encode()).hexdigest()
            (cache / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            self.assertFalse(aaf.try_reuse_cached_bundle(self.root, self.root / "fresh-target"))

    def test_cache_miss_on_tampered_manifest_metadata(self):
        # Same standard as the recipient-side verified_manifest: a manifest
        # whose own bundle_id no longer matches its content is never
        # trusted, cache or not. Every field but bundle_id itself is left
        # genuinely valid, so this isolates manifest_intact specifically -
        # schema/target/recipe/bundle_problem would all pass on their own.
        with patch.object(Path, "home", return_value=Path(self.temp.name) / "user"):
            cache = aaf.cache_dir()
            manifest = self.cache_manifest_and_files(cache)
            manifest["bundle_id"] = "0" * 64
            (cache / "manifest.json").write_text(json.dumps(manifest), encoding="utf-8")
            self.assertFalse(aaf.try_reuse_cached_bundle(self.root, self.root / "fresh-target"))

    def test_cache_miss_when_a_project_source_file_changed_since_caching(self):
        with patch.object(Path, "home", return_value=Path(self.temp.name) / "user"):
            self.cache_manifest_and_files(aaf.cache_dir())
            (self.root / aaf.PROJECTS[0][0] / "src/example.py").write_text("value = 2\n")
            self.assertFalse(aaf.try_reuse_cached_bundle(self.root, self.root / "fresh-target"))

    def test_save_bundle_to_cache_round_trips_into_a_reusable_cache(self):
        with patch.object(Path, "home", return_value=Path(self.temp.name) / "user"):
            # self.target (from setUp) has no "recipe" field yet - add it,
            # matching what a real build() run writes before saving to cache.
            self.manifest["recipe"] = aaf.build_recipe_digest()
            self.write_manifest()
            aaf.save_bundle_to_cache(self.target)
            fresh_target = self.root / "fresh-target"
            self.assertTrue(aaf.try_reuse_cached_bundle(self.root, fresh_target))
            self.assertTrue((fresh_target / "framework/wheels/fixture-1-py3-none-any.whl").is_file())

    def build_patches(self):
        return (
            patch.object(aaf, "require_windows"),
            patch.object(Path, "home", return_value=Path(self.temp.name) / "user"),
            patch.object(aaf.venv, "create", side_effect=lambda path, **kwargs: (path / "Scripts").mkdir(parents=True)),
            patch.object(aaf, "run", **{"return_value.stdout": "fixture==1\n"}),
            patch.object(aaf, "validate_runtime"),
            patch.object(aaf, "write_offline_markers"),
        )

    def test_build_short_circuits_on_a_cache_hit_without_touching_pip_or_venv(self):
        shutil.rmtree(self.target)
        windows, home, create, run, validate, markers = self.build_patches()
        with windows, home, create as made, run as called, validate, markers as markers_written, \
                patch.object(aaf, "try_reuse_cached_bundle", return_value=True) as reuse, \
                patch.object(aaf, "save_bundle_to_cache") as save:
            aaf.build(self.root, "https://example.invalid/simple")
            reuse.assert_called_once()
            markers_written.assert_called_once()
            save.assert_not_called()  # a reused cache is never re-saved to itself
            made.assert_not_called()  # no venv created - the whole build pipeline was skipped
            called.assert_not_called()  # no pip/wheel work happened

    def test_build_checks_then_populates_the_cache_on_a_miss(self):
        shutil.rmtree(self.target)
        windows, home, create, run, validate, markers = self.build_patches()
        with windows, home, create, run, validate, markers, \
                patch.object(aaf, "try_reuse_cached_bundle", return_value=False) as reuse, \
                patch.object(aaf, "save_bundle_to_cache") as save:
            aaf.build(self.root, "https://example.invalid/simple")
            reuse.assert_called_once()
            save.assert_called_once()

    def test_build_never_consults_the_cache_when_disabled(self):
        shutil.rmtree(self.target)
        windows, home, create, run, validate, markers = self.build_patches()
        with windows, home, create, run, validate, markers, \
                patch.object(aaf, "try_reuse_cached_bundle") as reuse, \
                patch.object(aaf, "save_bundle_to_cache") as save:
            aaf.build(self.root, "https://example.invalid/simple", use_cache=False)
            reuse.assert_not_called()
            save.assert_not_called()


if __name__ == "__main__":
    unittest.main()

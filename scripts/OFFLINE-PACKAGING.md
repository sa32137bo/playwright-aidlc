# Windows handoff without private-registry access

`pack.ps1` now builds installable Python wheels instead of copying virtual
environments. This replaces the old `vendor/aaf-venv` and
`vendor/aaf-capabilities-venv` format. Existing old zips must be rebuilt.

> **Workbench disabled by default (2026-09-25).** The workbench (Toolkit
> Workbench, Knowledge Assistant, connected-ai-dlc-tlc and the offline Python
> bundle) no longer ships. `pack.ps1` now packages `playwright-aidlc` alone,
> and `unpack.ps1` provisions the CLC workspace alone. Everything about the
> workbench below still works, but only behind a switch: `pack.ps1
> -IncludeWorkbench` and `unpack.ps1 -IncludeWorkbench`.

## Packaging machine

Use a Windows machine with Python 3.11+ and access to the Prolifics registry and
public PyPI/npm services. The recipient needs the same Python major/minor,
implementation and architecture (recorded in `vendor/aaf/manifest.json`). Use
`-Python` to select the desired interpreter; it defaults to `python` on PATH.

From the updated `playwright-aidlc` checkout, with updated sibling checkouts for
`knowledgeassistant`, `connected-ai-dlc-tlc`, and `toolkit-workbench`:

```powershell
powershell -ExecutionPolicy Bypass -File .\scripts\pack.ps1
```

Safe to re-run as-is, any day, including same-day retries - an existing
`-OutputZip` is backed up to `<OutputZip>.bak` first, never deleted before the
rebuild actually finishes. `-Force` skips that backup and overwrites
`-OutputZip` directly, for anyone who doesn't want it kept.

The script resolves separate dependency sets for AAF, toolkit capabilities,
Knowledge Service and the Toolkit Workbench API. It builds wheelhouses, installs
them in fresh environments with registry access disabled, checks imports and
package consistency, and locks the selected versions. It also exercises the
bundled AAF's own capabilities installer using pip and its normal resolver
selection with offline settings. Errors abort packaging before zip creation.
Checksums cover wheels, locks and the packaged Python project sources.

`-SkipVendorAaf` is an explicit **online-only** opt-out. Do not use it for Corpay
or any recipient without private-registry access. No pre-existing AAF installation
is required on the packaging machine; dependencies are built from the staged
project requirements.

**The wheel build is cached** under `%USERPROFILE%\.aaf\pack-cache` on the
packaging machine and reused on the next `pack.ps1` run, instead of paying for
a full rebuild every time - AAF/toolkit dependency updates are rare, so most
runs should be a fast cache hit (seconds, not several minutes). The cache
self-invalidates the moment anything that would actually change the bundle
does: a project source file, this script's own build recipe
(`offline_aaf.py` itself), or the packaging machine's Python version. `pack.ps1
-NoCache` forces a real rebuild regardless - only needed if you suspect the
cache mechanism itself, not something it already checks for. **Note this cache
only starts helping from the second build onward** - the very next `pack.ps1`
run after adopting this feature still pays the full cost once, since there is
nothing to have cached yet.

**Recipient Python must match what the packaging machine built with, exactly
(major.minor).** A wheel built for one CPython minor version generally will
not load on another - this is a real ABI constraint, not the script being
overcautious. If a recipient's error says a bundle was built for a different
Python than the machine has (e.g. built for 3.12, machine has 3.13), **do
not** try to install a different Python on the recipient machine to match an
old bundle - the fix is on the packaging side: rebuild with `-Python` pointed
at an interpreter matching the recipient's actual Python
(`-Python "<path to a 3.13 python.exe>"`), then re-copy and re-extract the new
zip. The error message itself now says this.

## Recipient machine

Extract the entire zip, retaining its sibling directory layout. Use a matching
Python on PATH, then run:

```powershell
powershell -ExecutionPolicy Bypass -File .\playwright-aidlc\scripts\unpack.ps1
```

Unpack validates the bundle and creates fresh environments under
`%USERPROFILE%\.aaf\offline\<bundle>\<extraction-path>\`. Existing shared
`.aaf\venv` and `.aaf\capabilities-venv` folders are not trusted or overwritten.
A failed managed environment is preserved under a `.failed-*` name and recreated.
Moving the extracted package creates new environments so interpreter and editable
source paths remain correct.

The three Windows launchers detect the `.aaf-offline` marker themselves. They
work even when the Toolkit Workbench was already running before unpacking. They
skip online Python update/install branches and supply local wheel/constraint
settings to pip and uv invoked internally by AAF. A damaged or missing bundle is
an error, never an instruction to get VPN access.

Configuration is still required: restore/fill each toolkit's `envconfig.yaml` as
before. No model-provider credentials are included in the wheel bundle.

This is a **no-private-registry Python installation**, not a fully air-gapped
application package. Node dependencies, Playwright browser downloads, optional
embedding-model downloads, and configured LLM/source services still need their
usual connectivity. The optional `local-embeddings` Python extra is not bundled.

## Verification

Portable helper tests and PowerShell parsing can run on the development Mac:

```sh
python3 -m unittest discover -s tests -p 'test_offline_aaf.py' -v
```

The final Windows acceptance check is to extract the newly built zip under a
different user/path with private GitLab access unavailable, run unpack, and verify
both toolkits report running. A successful helper unit test is not a substitute
for this check. Inspect `vendor/aaf/manifest.json` for target Python details;
installation errors should now identify mismatches or missing bundle files rather
than attempting GitLab and then reporting a missing `aaf-start` command.

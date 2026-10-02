#!/usr/bin/env python3
"""BEATDASH health/version/revision verifier shared by CI and local tests."""
from __future__ import annotations
import argparse, json, sys, time, urllib.error, urllib.request
from dataclasses import dataclass

@dataclass
class Check:
    ok: bool
    reason: str
    actual_version: str = "<unavailable>"
    actual_revision: str = "<unavailable>"
    health_ok: object = "<unavailable>"

def evaluate(payload: object, expected_version: str, expected_revision: str) -> Check:
    if not isinstance(payload, dict): return Check(False, "JSON response is not an object")
    version=str(payload.get("version", "<missing>")); revision=str(payload.get("revision", "<missing>")); health_ok=payload.get("ok", "<missing>")
    if health_ok is not True: return Check(False, "Health OK mismatch (ok != true)", version, revision, health_ok)
    if version != expected_version: return Check(False, "Version mismatch", version, revision, health_ok)
    if revision != expected_revision: return Check(False, "Revision mismatch", version, revision, health_ok)
    return Check(True, "PASS", version, revision, health_ok)

def print_diag(url: str, ev: str, er: str, check: Check, attempt: int|None=None) -> None:
    if attempt is not None: print(f"Attempt: {attempt}")
    print(f"Health endpoint: {url}")
    print(f"Expected version: {ev}"); print(f"Actual version: {check.actual_version}")
    print(f"Expected revision: {er}"); print(f"Actual revision: {check.actual_revision}")
    print(f"Health OK: {str(check.health_ok).lower() if isinstance(check.health_ok,bool) else check.health_ok}")
    print(f"Status: {check.reason}")

def fetch(url: str, timeout: float) -> object:
    req=urllib.request.Request(url, headers={"Accept":"application/json","Cache-Control":"no-cache"})
    with urllib.request.urlopen(req, timeout=timeout) as response:
        if response.status < 200 or response.status >= 300: raise urllib.error.HTTPError(url,response.status,"HTTP error",response.headers,None)
        return json.load(response)

def main() -> int:
    ap=argparse.ArgumentParser(); ap.add_argument('--url',required=True); ap.add_argument('--expected-version',required=True); ap.add_argument('--expected-revision',required=True)
    ap.add_argument('--attempts',type=int,default=60); ap.add_argument('--interval',type=float,default=5); ap.add_argument('--timeout',type=float,default=10)
    ap.add_argument('--stable-mismatch-limit',type=int,default=6)
    a=ap.parse_args(); last=Check(False,"No response received"); stable_sig=None; stable_count=0
    for attempt in range(1,a.attempts+1):
        try:
            payload=fetch(a.url,a.timeout); last=evaluate(payload,a.expected_version,a.expected_revision); print_diag(a.url,a.expected_version,a.expected_revision,last,attempt)
            if last.ok: return 0
            sig=(last.reason,last.actual_version,last.actual_revision,last.health_ok)
            # A stable, healthy revision with only a version mismatch is not deployment propagation.
            if last.reason == 'Version mismatch' and last.actual_revision == a.expected_revision and last.health_ok is True:
                stable_count = stable_count + 1 if sig == stable_sig else 1; stable_sig=sig
                if stable_count >= a.stable_mismatch_limit:
                    print("Failing early: expected revision is already live but its version remains different; check VERSION propagation/configuration.", file=sys.stderr); return 2
            else: stable_count=0; stable_sig=sig
        except urllib.error.HTTPError as e:
            last=Check(False,f"HTTP error: {e.code}"); print_diag(a.url,a.expected_version,a.expected_revision,last,attempt)
        except urllib.error.URLError as e:
            last=Check(False,f"Health endpoint connection failure: {e.reason}"); print_diag(a.url,a.expected_version,a.expected_revision,last,attempt)
        except (json.JSONDecodeError, UnicodeDecodeError) as e:
            last=Check(False,f"JSON response error: {e}"); print_diag(a.url,a.expected_version,a.expected_revision,last,attempt)
        except Exception as e:
            last=Check(False,f"Health endpoint connection failure: {type(e).__name__}: {e}"); print_diag(a.url,a.expected_version,a.expected_revision,last,attempt)
        if attempt < a.attempts: time.sleep(a.interval)
    print_diag(a.url,a.expected_version,a.expected_revision,last)
    print("Deployment propagation timeout: health/version/revision did not converge.", file=sys.stderr); return 3
if __name__=='__main__': raise SystemExit(main())

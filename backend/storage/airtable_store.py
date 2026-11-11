"""Armazenamento no Airtable."""
import os
import time
import logging
import requests

from .base import FIELDS, StoreError, clean_record

log = logging.getLogger("storage.airtable")

# o Airtable gera ID e "AtualizadoEm" sozinho
_KEY_TO_FIELD = {k: f for k, f in FIELDS if k not in ("id", "atualizadoEm")}


class AirtableStore:
    name = "airtable"
    snapshot_ttl = 6.0

    def __init__(self, token: str, base_id: str, table: str, timeout: int = 12, retries: int = 4):
        self.api = f"https://api.airtable.com/v0/{base_id}/{requests.utils.quote(table, safe='')}"
        self.timeout = timeout
        self.retries = retries
        self.http = requests.Session()
        self.http.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})

    @classmethod
    def from_env(cls):
        token = os.getenv("AIRTABLE_TOKEN")
        base_id = os.getenv("AIRTABLE_BASE_ID")
        if not token or not base_id:
            raise RuntimeError("Configure AIRTABLE_TOKEN e AIRTABLE_BASE_ID para usar o Airtable.")
        return cls(token, base_id, os.getenv("AIRTABLE_TABLE_NAME", "Disparos"),
                   int(os.getenv("AIRTABLE_TIMEOUT", "12")), int(os.getenv("AIRTABLE_MAX_RETRIES", "4")))

    # ---------- HTTP ----------
    def _request(self, method, url, **kwargs):
        backoff = 0.6
        for _ in range(self.retries):
            try:
                resp = self.http.request(method, url, timeout=self.timeout, **kwargs)
                if resp.status_code == 429 or resp.status_code >= 500:
                    wait = float(resp.headers.get("Retry-After") or backoff)
                    log.warning("Airtable %s; retry em %.1fs", resp.status_code, wait)
                    time.sleep(wait); backoff = min(backoff * 2, 6); continue
                return self._check(resp)
            except requests.RequestException as e:
                log.warning("Erro de rede Airtable (%s); retry em %.1fs", e, backoff)
                time.sleep(backoff); backoff = min(backoff * 2, 6)
        return self._check(self.http.request(method, url, timeout=self.timeout, **kwargs))

    @staticmethod
    def _check(resp):
        if resp.ok:
            return resp.json() if resp.text else {}
        try:
            msg = resp.json().get("error", {})
            msg = msg.get("message") if isinstance(msg, dict) else str(msg)
        except ValueError:
            msg = resp.text
        raise StoreError(f"Airtable {resp.status_code}: {msg}", 400 if resp.status_code == 422 else 502)

    @staticmethod
    def _normalize(rec):
        f = rec.get("fields", {}) or {}
        out = {k: f.get(field, "") for k, field in FIELDS}
        out["id"] = rec.get("id")
        return clean_record(out)

    @staticmethod
    def _to_fields(data: dict) -> dict:
        fields = {}
        for k, v in data.items():
            if k in _KEY_TO_FIELD:
                fields[_KEY_TO_FIELD[k]] = None if v == "" and k == "tipoDisparo" else v
        return fields

    # ---------- API ----------
    def list_records(self):
        records, params = [], {"pageSize": 100, "sort[0][field]": "AtualizadoEm", "sort[0][direction]": "desc"}
        while True:
            payload = self._request("GET", self.api, params=params)
            records.extend(payload.get("records", []))
            if "offset" not in payload:
                break
            params["offset"] = payload["offset"]
        return [self._normalize(r) for r in records]

    def create(self, data: dict):
        rec = self._request("POST", self.api, json={"fields": self._to_fields(data)}, params={"typecast": "true"})
        return self._normalize(rec)

    def update(self, rid: str, patch: dict):
        rec = self._request("PATCH", f"{self.api}/{rid}", json={"fields": self._to_fields(patch)}, params={"typecast": "true"})
        return self._normalize(rec)

    def delete(self, rid: str):
        self._request("DELETE", f"{self.api}/{rid}")
